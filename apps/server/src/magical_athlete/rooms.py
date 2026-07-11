from __future__ import annotations

import asyncio
import secrets
import string
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from .game import DemoGameEngine, GameEngine, GameRuleError, GameState, Player
from .protocol import (
    ErrorMessage,
    JoinRoomIntent,
    RollDiceIntent,
    SelectAthleteIntent,
    StartGameIntent,
)


class RoomError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(slots=True)
class RoomPlayer:
    player: Player
    reconnect_token: str
    connected: bool = True
    socket: WebSocket | None = None
    seen_action_ids: set[str] = field(default_factory=set)


@dataclass(slots=True)
class Room:
    id: str
    engine: GameEngine
    players: dict[str, RoomPlayer] = field(default_factory=dict)
    game_state: GameState | None = None
    revision: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def public_state(self, viewer_id: str | None = None) -> dict[str, Any]:
        if self.game_state is None:
            game = self.engine.public_state(self.engine.create_game(tuple()), viewer_id)
        else:
            game = self.engine.public_state(self.game_state, viewer_id)
        connected = {player_id: member.connected for player_id, member in self.players.items()}
        for player in game["players"]:
            player["connected"] = connected.get(player["id"], False)
        return {"roomId": self.id, "revision": self.revision, "game": game}


class InMemoryRoomRepository:
    """Process-local repository. Replace this boundary with Redis for multi-instance deploys."""

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def create(self, code_length: int, engine: GameEngine | None = None) -> Room:
        async with self._lock:
            for _ in range(20):
                room_id = "".join(secrets.choice(string.ascii_uppercase) for _ in range(code_length))
                if room_id not in self._rooms:
                    room = Room(id=room_id, engine=engine or DemoGameEngine())
                    self._rooms[room_id] = room
                    return room
        raise RoomError("ROOM_CODE_EXHAUSTED", "暂时无法创建房间，请重试")

    async def get(self, room_id: str) -> Room | None:
        return self._rooms.get(room_id.upper())


class RoomManager:
    def __init__(self, repository: InMemoryRoomRepository) -> None:
        self.repository = repository

    async def join(self, websocket: WebSocket, intent: JoinRoomIntent) -> tuple[Room, str]:
        room = await self.repository.get(intent.room_id)
        if room is None:
            raise RoomError("ROOM_NOT_FOUND", "房间不存在")

        async with room.lock:
            if intent.player_id:
                member = room.players.get(intent.player_id)
                if member is None or not secrets.compare_digest(
                    member.reconnect_token, intent.reconnect_token or ""
                ):
                    raise RoomError("INVALID_RECONNECT_TOKEN", "重连凭证无效")
                if member.socket and member.socket is not websocket:
                    await member.socket.close(code=4001, reason="connected elsewhere")
                member.connected = True
                member.socket = websocket
                player_id = member.player.id
            else:
                if room.game_state and room.game_state.phase != "LOBBY":
                    raise RoomError("GAME_ALREADY_STARTED", "比赛已开始，不能加入新玩家")
                if len(room.players) >= 4:
                    raise RoomError("ROOM_FULL", "房间已满")
                player_id = uuid4().hex
                member = RoomPlayer(
                    player=Player(id=player_id, name=intent.player_name.strip()),
                    reconnect_token=secrets.token_urlsafe(24),
                    socket=websocket,
                )
                room.players[player_id] = member
                room.game_state = room.engine.create_game(
                    tuple(item.player for item in room.players.values())
                )
                room.revision += 1

            await websocket.send_json(
                {
                    "type": "WELCOME",
                    "playerId": player_id,
                    "reconnectToken": member.reconnect_token,
                    **room.public_state(player_id),
                }
            )
            await self._broadcast_locked(
                room,
                {"type": "STATE_UPDATED", "events": [{"type": "PLAYER_JOINED", "playerId": player_id}]},
                exclude=websocket,
            )
            return room, player_id

    async def handle_intent(
        self,
        room: Room,
        player_id: str,
        intent: StartGameIntent | SelectAthleteIntent | RollDiceIntent,
    ) -> None:
        async with room.lock:
            member = room.players[player_id]
            if intent.action_id in member.seen_action_ids:
                await member.socket.send_json(
                    {"type": "ACTION_ACK", "actionId": intent.action_id, "revision": room.revision}
                )
                return
            member.seen_action_ids.add(intent.action_id)
            if len(member.seen_action_ids) > 500:
                member.seen_action_ids = {intent.action_id}

            try:
                assert room.game_state is not None
                if isinstance(intent, StartGameIntent):
                    transition = room.engine.start(room.game_state, player_id)
                elif isinstance(intent, SelectAthleteIntent):
                    transition = room.engine.select_athlete(
                        room.game_state, player_id, intent.athlete_id
                    )
                else:
                    transition = room.engine.roll_dice(room.game_state, player_id)
            except GameRuleError as error:
                await member.socket.send_json(
                    ErrorMessage(
                        code=error.code,
                        message=str(error),
                        actionId=intent.action_id,
                    ).model_dump(by_alias=True)
                )
                return

            room.game_state = transition.state
            room.revision += 1
            await self._broadcast_locked(
                room,
                {
                    "type": "STATE_UPDATED",
                    "actionId": intent.action_id,
                    "events": list(transition.events),
                },
            )

    async def disconnect(self, room: Room, player_id: str, websocket: WebSocket) -> None:
        async with room.lock:
            member = room.players.get(player_id)
            if member is None or member.socket is not websocket:
                return
            member.connected = False
            member.socket = None
            room.revision += 1
            await self._broadcast_locked(
                room,
                {
                    "type": "STATE_UPDATED",
                    "events": [{"type": "PLAYER_DISCONNECTED", "playerId": player_id}],
                },
            )

    async def _broadcast_locked(
        self,
        room: Room,
        envelope: dict[str, Any],
        exclude: WebSocket | None = None,
    ) -> None:
        failed: list[RoomPlayer] = []
        for recipient_id, member in room.players.items():
            if not member.connected or member.socket is None or member.socket is exclude:
                continue
            try:
                message = {**envelope, **room.public_state(recipient_id)}
                await member.socket.send_json(message)
            except RuntimeError:
                failed.append(member)
        for member in failed:
            member.connected = False
            member.socket = None
