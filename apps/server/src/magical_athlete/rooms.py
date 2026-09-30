from __future__ import annotations

import asyncio
import secrets
import string
from datetime import UTC, datetime, timedelta
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from .game import GameEngine, GameRuleError, GameState, GameTransition, MagsimGameEngine, Player
from .protocol import (
    AdvanceRaceIntent,
    DraftAthleteIntent,
    ErrorMessage,
    JoinRoomIntent,
    KickPlayerIntent,
    LeaveRoomIntent,
    RollDiceIntent,
    RollStartIntent,
    ResolveDecisionIntent,
    SelectRacersIntent,
    SetVariantIntent,
    StartGameIntent,
)


ROLL_ANIMATION_LEAD_SECONDS = 0.35


class RoomError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RoomSocket(Protocol):
    async def send_json(self, message: dict[str, Any]) -> None: ...

    async def close(self, code: int = 1000, reason: str = "") -> None: ...


@dataclass(slots=True)
class RoomPlayer:
    player: Player
    reconnect_token: str
    connected: bool = True
    socket: RoomSocket | None = None
    seen_action_ids: set[str] = field(default_factory=set)


@dataclass(slots=True)
class Room:
    id: str
    engine: GameEngine
    players: dict[str, RoomPlayer] = field(default_factory=dict)
    game_state: GameState | None = None
    revision: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    decision_task: asyncio.Task[None] | None = None
    decision_deadline: datetime | None = None
    roll_task: asyncio.Task[None] | None = None
    roll_deadline: datetime | None = None

    def public_state(self, viewer_id: str | None = None) -> dict[str, Any]:
        if self.game_state is None:
            game = self.engine.public_state(self.engine.create_game(tuple()), viewer_id)
        else:
            game = self.engine.public_state(self.game_state, viewer_id)
        if game.get("pendingDecision") is not None and self.decision_deadline is not None:
            game["pendingDecision"] = {
                **game["pendingDecision"],
                "deadlineAt": self.decision_deadline.isoformat(),
            }
        if game.get("pendingRoll") is not None and self.roll_deadline is not None:
            game["pendingRoll"] = {
                **game["pendingRoll"],
                "deadlineAt": self.roll_deadline.isoformat(),
            }
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
                    room = Room(id=room_id, engine=engine or MagsimGameEngine())
                    self._rooms[room_id] = room
                    return room
        raise RoomError("ROOM_CODE_EXHAUSTED", "暂时无法创建房间，请重试")

    async def get(self, room_id: str) -> Room | None:
        return self._rooms.get(room_id.upper())


class RoomManager:
    def __init__(self, repository: InMemoryRoomRepository, *, local_timers: bool = True) -> None:
        self.repository = repository
        self.local_timers = local_timers

    async def join(self, websocket: RoomSocket, intent: JoinRoomIntent) -> tuple[Room, str]:
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
                if len(room.players) >= 6:
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
                {
                    "type": "STATE_UPDATED",
                    "events": [{"type": "PLAYER_JOINED", "playerId": player_id}],
                    "rollResults": [],
                },
                exclude=websocket,
            )
            return room, player_id

    async def handle_intent(
        self,
        room: Room,
        player_id: str,
        intent: StartGameIntent
        | LeaveRoomIntent
        | KickPlayerIntent
        | SetVariantIntent
        | RollStartIntent
        | DraftAthleteIntent
        | SelectRacersIntent
        | RollDiceIntent
        | ResolveDecisionIntent
        | AdvanceRaceIntent,
    ) -> None:
        async with room.lock:
            member = room.players.get(player_id)
            if member is None:
                return
            if isinstance(intent, LeaveRoomIntent):
                if not self._lobby_open(room):
                    await member.socket.send_json(ErrorMessage(
                        code="GAME_ALREADY_STARTED", message="游戏已开始，不能退出房间",
                        actionId=intent.action_id,
                    ).model_dump(by_alias=True))
                    return
                removed = self._remove_member_locked(room, player_id)
                await member.socket.send_json({"type": "ROOM_LEFT"})
                await self._announce_player_left_locked(room, removed)
                await member.socket.close()
                return
            if isinstance(intent, KickPlayerIntent):
                await self._kick_player_locked(room, member, intent)
                return
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
                elif isinstance(intent, SetVariantIntent):
                    transition = room.engine.set_variant(
                        room.game_state, player_id, intent.double_racer
                    )
                elif isinstance(intent, RollStartIntent):
                    transition = room.engine.roll_start(room.game_state, player_id)
                elif isinstance(intent, DraftAthleteIntent):
                    transition = room.engine.draft_athlete(
                        room.game_state, player_id, intent.athlete_id
                    )
                elif isinstance(intent, SelectRacersIntent):
                    transition = room.engine.select_racers(
                        room.game_state, player_id, intent.athlete_ids
                    )
                elif isinstance(intent, RollDiceIntent):
                    pending_roll = room.game_state.pending_roll
                    rolling_player_id = (
                        pending_roll.get("nextPlayerId")
                        if pending_roll is not None
                        else room.game_state.active_player_id
                    )
                    if (
                        room.game_state.phase == "RACING"
                        and rolling_player_id == player_id
                        and room.game_state.magsim_engine is not None
                        and room.game_state.pending_decision is None
                        and room.game_state.resolution_status == "WAITING_FOR_ROLL"
                    ):
                        await self._broadcast_locked(
                            room,
                            {
                                "type": "ROLL_STARTED",
                                "actionId": intent.action_id,
                                "playerId": player_id,
                            },
                        )
                        # Keep the start signal visible long enough for background tabs and
                        # slower WebGL clients to commit the first animation frame.
                        await asyncio.sleep(ROLL_ANIMATION_LEAD_SECONDS)
                    transition = room.engine.roll_dice(room.game_state, player_id)
                elif isinstance(intent, ResolveDecisionIntent):
                    transition = room.engine.resolve_decision(
                        room.game_state,
                        player_id,
                        intent.decision_id,
                        intent.option_id,
                    )
                else:
                    transition = room.engine.advance_race(room.game_state, player_id)
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
            self._sync_decision_timer_locked(room)
            self._sync_roll_timer_locked(room)
            roll_results = self._roll_results(transition, room.revision)
            await self._broadcast_locked(
                room,
                {
                    "type": "STATE_UPDATED",
                    "actionId": intent.action_id,
                    "events": list(transition.events),
                    "rollResults": roll_results,
                },
            )

    @staticmethod
    def _lobby_open(room: Room) -> bool:
        return room.game_state is not None and room.game_state.phase == "LOBBY"

    @staticmethod
    def _host_id(room: Room) -> str | None:
        return next(iter(room.players), None)

    def _remove_member_locked(self, room: Room, player_id: str) -> RoomPlayer:
        member = room.players.pop(player_id)
        room.game_state = room.engine.create_game(
            tuple(item.player for item in room.players.values())
        )
        room.revision += 1
        return member

    async def _announce_player_left_locked(
        self, room: Room, member: RoomPlayer, *, reason: str | None = None
    ) -> None:
        event: dict[str, Any] = {
            "type": "PLAYER_LEFT",
            "playerId": member.player.id,
            "playerName": member.player.name,
        }
        if reason is not None:
            event["reason"] = reason
        await self._broadcast_locked(
            room,
            {"type": "STATE_UPDATED", "events": [event], "rollResults": []},
        )

    async def _kick_player_locked(
        self, room: Room, member: RoomPlayer, intent: KickPlayerIntent
    ) -> None:
        async def reject(code: str, message: str) -> None:
            await member.socket.send_json(
                ErrorMessage(
                    code=code, message=message, actionId=intent.action_id
                ).model_dump(by_alias=True)
            )

        if not self._lobby_open(room):
            await reject("GAME_ALREADY_STARTED", "游戏已开始，不能移出玩家")
            return
        if member.player.id != self._host_id(room):
            await reject("NOT_HOST", "只有房主可以移出玩家")
            return
        if intent.target_player_id == member.player.id:
            await reject("CANNOT_KICK_SELF", "不能移出自己，请使用退出房间")
            return
        target = room.players.get(intent.target_player_id)
        if target is None:
            await reject("PLAYER_NOT_FOUND", "该玩家不在房间中")
            return

        kicked = self._remove_member_locked(room, target.player.id)
        if kicked.socket is not None:
            await kicked.socket.send_json({"type": "KICKED"})
        await self._announce_player_left_locked(room, kicked, reason="KICKED")
        if kicked.socket is not None:
            await kicked.socket.close(code=4002, reason="removed by host")

    def _sync_decision_timer_locked(self, room: Room) -> None:
        pending = room.game_state.pending_decision if room.game_state else None
        if room.decision_task is not None:
            room.decision_task.cancel()
            room.decision_task = None
        room.decision_deadline = None
        if pending is None:
            return
        room.decision_deadline = datetime.now(UTC) + timedelta(seconds=60)
        if not self.local_timers:
            return
        room.decision_task = asyncio.create_task(
            self._decision_timeout(room, pending["id"]),
            name=f"decision-timeout-{room.id}",
        )

    def _sync_roll_timer_locked(self, room: Room) -> None:
        pending = room.game_state.pending_roll if room.game_state else None
        if room.roll_task is not None:
            room.roll_task.cancel()
            room.roll_task = None
        room.roll_deadline = None
        if pending is None:
            return
        room.roll_deadline = datetime.now(UTC) + timedelta(seconds=60)
        if not self.local_timers:
            return
        room.roll_task = asyncio.create_task(
            self._roll_timeout(room, pending["id"], pending["throwIndex"]),
            name=f"roll-timeout-{room.id}",
        )

    async def _roll_timeout(
        self,
        room: Room,
        roll_id: str,
        throw_index: int,
    ) -> None:
        try:
            await asyncio.sleep(60)
            async with room.lock:
                state = room.game_state
                pending = state.pending_roll if state else None
                if (
                    state is None
                    or pending is None
                    or pending["id"] != roll_id
                    or pending["throwIndex"] != throw_index
                ):
                    return
                transition = room.engine.roll_dice(
                    state,
                    pending["nextPlayerId"],
                    timed_out=True,
                )
                room.game_state = transition.state
                room.revision += 1
                room.roll_task = None
                room.roll_deadline = None
                self._sync_decision_timer_locked(room)
                self._sync_roll_timer_locked(room)
                await self._broadcast_locked(
                    room,
                    {
                        "type": "STATE_UPDATED",
                        "events": list(transition.events),
                        "rollResults": self._roll_results(transition, room.revision),
                    },
                )
        except asyncio.CancelledError:
            return

    async def _decision_timeout(self, room: Room, decision_id: str) -> None:
        try:
            await asyncio.sleep(60)
            async with room.lock:
                state = room.game_state
                if state is None or state.pending_decision is None or state.pending_decision["id"] != decision_id:
                    return
                player_id = state.pending_decision["playerId"]
                transition = room.engine.resolve_decision(
                    state, player_id, decision_id, "", timed_out=True
                )
                room.game_state = transition.state
                room.revision += 1
                room.decision_task = None
                room.decision_deadline = None
                if transition.state.pending_decision is not None:
                    self._sync_decision_timer_locked(room)
                self._sync_roll_timer_locked(room)
                await self._broadcast_locked(
                    room,
                    {
                        "type": "STATE_UPDATED",
                        "events": list(transition.events),
                        "rollResults": self._roll_results(transition, room.revision),
                    },
                )
        except asyncio.CancelledError:
            return

    async def resolve_expired_decision(self, room: Room, now: datetime | None = None) -> bool:
        async with room.lock:
            state = room.game_state
            current_time = now or datetime.now(UTC)
            if (
                state is None
                or state.pending_decision is None
                or room.decision_deadline is None
                or room.decision_deadline > current_time
            ):
                return False
            decision_id = state.pending_decision["id"]
            player_id = state.pending_decision["playerId"]
            transition = room.engine.resolve_decision(state, player_id, decision_id, "", timed_out=True)
            room.game_state = transition.state
            room.revision += 1
            room.decision_deadline = None
            if transition.state.pending_decision is not None:
                self._sync_decision_timer_locked(room)
            self._sync_roll_timer_locked(room)
            await self._broadcast_locked(room, {
                "type": "STATE_UPDATED",
                "events": list(transition.events),
                "rollResults": self._roll_results(transition, room.revision),
            })
            return True

    async def resolve_expired_roll(self, room: Room, now: datetime | None = None) -> bool:
        async with room.lock:
            state = room.game_state
            current_time = now or datetime.now(UTC)
            if (
                state is None
                or state.pending_roll is None
                or room.roll_deadline is None
                or room.roll_deadline > current_time
            ):
                return False
            pending = state.pending_roll
            transition = room.engine.roll_dice(
                state,
                pending["nextPlayerId"],
                timed_out=True,
            )
            room.game_state = transition.state
            room.revision += 1
            room.roll_deadline = None
            self._sync_decision_timer_locked(room)
            self._sync_roll_timer_locked(room)
            await self._broadcast_locked(room, {
                "type": "STATE_UPDATED",
                "events": list(transition.events),
                "rollResults": self._roll_results(transition, room.revision),
            })
            return True

    async def disconnect(self, room: Room, player_id: str, websocket: RoomSocket) -> None:
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
                    "rollResults": [],
                },
            )

    async def _broadcast_locked(
        self,
        room: Room,
        envelope: dict[str, Any],
        exclude: RoomSocket | None = None,
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

    @staticmethod
    def _roll_results(transition: GameTransition, revision: int) -> list[dict[str, Any]]:
        race_number = transition.state.race_number
        results: list[dict[str, Any]] = []
        results_by_id: dict[str, dict[str, Any]] = {}
        seen_serials: set[int] = set()
        for index, event in enumerate(transition.events):
            if event.get("type") == "START_DICE_ROLLED":
                result = {
                    "id": f"revision:{revision}:event:{index}",
                    "kind": "ROLL_OFF",
                    "playerId": event.get("playerId"),
                    "values": list(event.get("values", [])),
                }
                results.append(result)
                results_by_id[result["id"]] = result
            elif event.get("type") in {"DIE_ROLLED", "ABILITY_DICE_ROLLED"}:
                result_id = event.get("rollResultId") or f"revision:{revision}:event:{index}"
                participant = {
                    "playerId": event.get("playerId"),
                    "athleteId": event.get("athleteId"),
                }
                result = {
                    "id": result_id,
                    "kind": event.get("kind"),
                    "playerId": event.get("playerId"),
                    "athleteId": event.get("athleteId"),
                    "values": [event["value"]],
                    "participants": [participant],
                    "abilityName": event.get("abilityName"),
                    "rollSessionId": event.get("rollSessionId"),
                    "throwIndex": event.get("throwIndex"),
                    "throwCount": event.get("throwCount"),
                }
                results.append(result)
                results_by_id[result_id] = result
            elif event.get("type") == "DICE_ROLLED" and isinstance(event.get("value"), int):
                serial = event.get("rollSerial")
                result_id = event.get("rollResultId")
                if not result_id:
                    result_id = (
                        f"race:{race_number}:serial:{serial}"
                        if isinstance(serial, int)
                        else f"revision:{revision}:event:{index}"
                    )
                if isinstance(serial, int):
                    seen_serials.add(serial)
                result = results_by_id.get(result_id)
                if result is None:
                    result = {
                        "id": result_id,
                        "kind": "MAIN_ROLL",
                        "playerId": event.get("playerId"),
                        "athleteId": event.get("athleteId"),
                        "values": [event["value"]],
                        "rollSessionId": event.get("rollSessionId"),
                    }
                    results.append(result)
                    results_by_id[result_id] = result
                result.update({
                    "baseValue": event.get("baseValue"),
                    "finalValue": event.get("finalValue"),
                    "rollSerial": serial,
                })

        pending = transition.state.pending_decision
        preview = pending.get("rollPreview") if pending else None
        if preview and preview["rollSerial"] not in seen_serials:
            result_id = preview.get("rollResultId") or f"race:{race_number}:serial:{preview['rollSerial']}"
            if result_id not in results_by_id:
                results.append({
                    "id": result_id,
                    "kind": "MAIN_ROLL",
                    "playerId": pending.get("playerId"),
                    "athleteId": pending.get("athleteId"),
                    "values": [preview["value"]],
                    **preview,
                })
        return results
