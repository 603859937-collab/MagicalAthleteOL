import random
import time
from dataclasses import replace
from typing import Any

import pytest

from magical_athlete.athletes import ATHLETE_BY_ID
from magical_athlete.game import GamePhase, GameTransition, MagsimGameEngine, Player
from magical_athlete.protocol import RollDiceIntent
from magical_athlete.rooms import InMemoryRoomRepository, Room, RoomManager, RoomPlayer


class RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def send_json(self, message: dict[str, Any]) -> None:
        self.messages.append(message)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_race_roll_broadcasts_started_before_authoritative_result() -> None:
    engine = MagsimGameEngine(random.Random(9))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    teams = {
        "p0": (ATHLETE_BY_ID["banana"], ATHLETE_BY_ID["skipper"]),
        "p1": (ATHLETE_BY_ID["coach"], ATHLETE_BY_ID["alchemist"]),
    }
    state = replace(
        engine.create_game(players),
        phase=GamePhase.CHARACTER_SELECTION,
        teams=teams,
        first_turn_player_id="p0",
    )
    state = engine.select_racers(state, "p0", ("banana", "skipper")).state
    state = engine.select_racers(state, "p1", ("coach", "alchemist")).state
    active_player_id = state.active_player_id
    assert active_player_id is not None

    sockets = {player.id: RecordingSocket() for player in players}
    room = Room(
        id="TEST",
        engine=engine,
        game_state=state,
        players={
            player.id: RoomPlayer(player, "token", socket=sockets[player.id])
            for player in players
        },
    )
    manager = RoomManager(InMemoryRoomRepository())

    started_at = time.monotonic()
    await manager.handle_intent(
        room,
        active_player_id,
        RollDiceIntent(type="ROLL_DICE", actionId="roll-1"),
    )
    elapsed = time.monotonic() - started_at

    assert elapsed >= 0.3

    for socket in sockets.values():
        assert [message["type"] for message in socket.messages] == [
            "ROLL_STARTED",
            "STATE_UPDATED",
        ]
        assert socket.messages[0]["playerId"] == active_player_id
        assert any(
            event["type"] == "DICE_ROLLED"
            for event in socket.messages[1]["events"]
        )

    authoritative_results = sockets[active_player_id].messages[1]["rollResults"]
    assert authoritative_results
    assert len(authoritative_results[0]["values"]) == 1
    for socket in sockets.values():
        assert socket.messages[1]["rollResults"] == authoritative_results


@pytest.mark.anyio
async def test_tripped_turn_does_not_start_a_dice_animation() -> None:
    engine = MagsimGameEngine(random.Random(9))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    teams = {
        "p0": (ATHLETE_BY_ID["banana"], ATHLETE_BY_ID["skipper"]),
        "p1": (ATHLETE_BY_ID["coach"], ATHLETE_BY_ID["alchemist"]),
    }
    state = replace(
        engine.create_game(players),
        phase=GamePhase.CHARACTER_SELECTION,
        teams=teams,
        first_turn_player_id="p0",
    )
    state = engine.select_racers(state, "p0", ("banana", "skipper")).state
    state = engine.select_racers(state, "p1", ("coach", "alchemist")).state
    state.magsim_engine.get_racer(state.magsim_engine.state.current_racer_idx).tripped = True
    active_player_id = state.active_player_id
    assert active_player_id is not None

    sockets = {player.id: RecordingSocket() for player in players}
    room = Room(
        id="TEST",
        engine=engine,
        game_state=state,
        players={
            player.id: RoomPlayer(player, "token", socket=sockets[player.id])
            for player in players
        },
    )

    await RoomManager(InMemoryRoomRepository()).handle_intent(
        room,
        active_player_id,
        RollDiceIntent(type="ROLL_DICE", actionId="recover-1"),
    )

    for socket in sockets.values():
        assert [message["type"] for message in socket.messages] == ["STATE_UPDATED"]
        assert any(event["type"] == "TRIP_RECOVERED" for event in socket.messages[0]["events"])
        assert not any(event["type"] == "DICE_ROLLED" for event in socket.messages[0]["events"])


def test_roll_preview_and_final_event_share_the_same_result_id() -> None:
    engine = MagsimGameEngine(random.Random(4))
    state = engine.create_game((Player("p0", "Alice"), Player("p1", "Bob")))
    preview = {"rollSerial": 7, "value": 5, "baseValue": 5, "finalValue": 5}
    pending_state = replace(
        state,
        pending_decision={"playerId": "p0", "athleteId": "magician", "rollPreview": preview},
    )
    preview_results = RoomManager._roll_results(GameTransition(pending_state, ()), revision=10)
    final_results = RoomManager._roll_results(
        GameTransition(
            replace(pending_state, pending_decision=None),
            ({"type": "DICE_ROLLED", "playerId": "p0", "athleteId": "magician", "value": 5, "rollSerial": 7},),
        ),
        revision=11,
    )

    assert preview_results[0]["id"] == final_results[0]["id"]
