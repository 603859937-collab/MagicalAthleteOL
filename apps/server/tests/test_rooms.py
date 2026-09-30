import random
import time
from dataclasses import replace
from datetime import timedelta
from typing import Any

import pytest

from magical_athlete.athletes import ATHLETE_BY_ID
from magical_athlete.game import GamePhase, GameTransition, MagsimGameEngine, Player
from magical_athlete.protocol import (
    AdvanceRaceIntent,
    DraftAthleteIntent,
    KickPlayerIntent,
    ResolveDecisionIntent,
    RollDiceIntent,
    RollStartIntent,
    SelectRacersIntent,
    SetAutoDealIntent,
    StartGameIntent,
)
from magical_athlete.rooms import InMemoryRoomRepository, Room, RoomManager, RoomPlayer


class RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []
        self.closed: list[tuple[int, str]] = []

    async def send_json(self, message: dict[str, Any]) -> None:
        self.messages.append(message)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed.append((code, reason))


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
async def test_tripped_next_turn_recovers_without_an_extra_dice_animation() -> None:
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
    current_idx = state.magsim_engine.state.current_racer_idx
    next_idx = (current_idx + 1) % len(state.magsim_engine.state.racers)
    state.magsim_engine.get_racer(next_idx).tripped = True
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
        assert [message["type"] for message in socket.messages] == [
            "ROLL_STARTED",
            "STATE_UPDATED",
        ]
        events = socket.messages[1]["events"]
        assert any(event["type"] == "TRIP_RECOVERED" for event in events)
        assert sum(event["type"] == "DICE_ROLLED" for event in events) == 1


@pytest.mark.anyio
async def test_invalid_roll_does_not_broadcast_roll_started() -> None:
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
    state = replace(state, resolution_status="IDLE")
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
        "p0",
        RollDiceIntent(type="ROLL_DICE", actionId="invalid-roll"),
    )

    assert [message["type"] for message in sockets["p0"].messages] == ["ERROR"]
    assert sockets["p0"].messages[0]["code"] == "ROLL_NOT_AVAILABLE"
    assert sockets["p1"].messages == []


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


def test_jogged_main_move_publishes_no_die_to_animate() -> None:
    engine = MagsimGameEngine(random.Random(31))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    teams = {
        "p0": (ATHLETE_BY_ID["legs"], ATHLETE_BY_ID["banana"]),
        "p1": (ATHLETE_BY_ID["skipper"], ATHLETE_BY_ID["blimp"]),
    }
    state = replace(
        engine.create_game(players),
        phase=GamePhase.CHARACTER_SELECTION,
        teams=teams,
        first_turn_player_id="p0",
    )
    state = engine.select_racers(state, "p0", ("legs", "banana")).state
    state = engine.select_racers(state, "p1", ("skipper", "blimp")).state
    decision = state.pending_decision
    assert decision is not None and decision["abilityName"] == "LongLegs"

    jogged = engine.resolve_decision(state, "p0", decision["id"], "1")
    roll = next(event for event in jogged.events if event["type"] == "DICE_ROLLED")
    assert roll["noDice"] is True

    results = RoomManager._roll_results(GameTransition(jogged.state, jogged.events), revision=1)
    assert [result["values"] for result in results] == [[]]
    assert results[0]["noDice"] is True


@pytest.mark.anyio
async def test_leaving_lobby_releases_seat_and_transfers_host() -> None:
    from magical_athlete.protocol import JoinRoomIntent, LeaveRoomIntent

    class Socket(RecordingSocket):
        async def close(self, code=1000, reason="") -> None:
            pass

    repository = InMemoryRoomRepository()
    room = await repository.create(4)
    manager = RoomManager(repository)
    first, second = Socket(), Socket()
    _, host_id = await manager.join(first, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Alice"))
    _, next_id = await manager.join(second, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Bob"))
    await manager.handle_intent(room, host_id, LeaveRoomIntent(
        type="LEAVE_ROOM", actionId="leave"))
    await manager.disconnect(room, host_id, first)
    assert list(room.players) == [next_id]
    assert room.public_state()["game"]["players"][0]["id"] == next_id
    assert first.messages[-1] == {"type": "ROOM_LEFT"}
    assert second.messages[-1]["events"][0]["type"] == "PLAYER_LEFT"
    await manager.handle_intent(room, next_id, LeaveRoomIntent(
        type="LEAVE_ROOM", actionId="leave-last"))
    assert room.public_state()["game"]["players"] == []
    await manager.join(Socket(), JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Carol"))
    assert len(room.players) == 1


@pytest.mark.anyio
async def test_leaving_after_start_keeps_player() -> None:
    from magical_athlete.protocol import LeaveRoomIntent

    engine = MagsimGameEngine(random.Random(9))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    socket = RecordingSocket()
    room = Room(id="TEST", engine=engine,
                game_state=engine.start(engine.create_game(players), "p0").state,
                players={p.id: RoomPlayer(p, "token", socket=socket) for p in players})
    await RoomManager(InMemoryRoomRepository()).handle_intent(
        room, "p0", LeaveRoomIntent(type="LEAVE_ROOM", actionId="late"))
    assert len(room.players) == 2
    assert socket.messages[-1]["code"] == "GAME_ALREADY_STARTED"


@pytest.mark.anyio
async def test_host_can_kick_a_lobby_player() -> None:
    from magical_athlete.protocol import JoinRoomIntent, KickPlayerIntent

    class Socket(RecordingSocket):
        async def close(self, code=1000, reason="") -> None:
            pass

    repository = InMemoryRoomRepository()
    room = await repository.create(4)
    manager = RoomManager(repository)
    host, guest = Socket(), Socket()
    _, host_id = await manager.join(host, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Alice"))
    _, guest_id = await manager.join(guest, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Bob"))

    await manager.handle_intent(room, host_id, KickPlayerIntent(
        type="KICK_PLAYER", actionId="kick", targetPlayerId=guest_id))

    assert list(room.players) == [host_id]
    assert [player["id"] for player in room.public_state()["game"]["players"]] == [host_id]
    assert guest.messages[-1] == {"type": "KICKED"}
    assert host.messages[-1]["events"] == [
        {"type": "PLAYER_LEFT", "playerId": guest_id, "playerName": "Bob", "reason": "KICKED"}
    ]

    await manager.join(Socket(), JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Carol"))
    assert len(room.players) == 2


@pytest.mark.anyio
async def test_host_auto_deal_setting_deals_teams_when_the_game_starts() -> None:
    engine = MagsimGameEngine(random.Random(6))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    sockets = {player.id: RecordingSocket() for player in players}
    room = Room(
        id="TEST",
        engine=engine,
        game_state=engine.create_game(players),
        players={
            player.id: RoomPlayer(player, "token", socket=sockets[player.id])
            for player in players
        },
    )
    manager = RoomManager(InMemoryRoomRepository())

    await manager.handle_intent(
        room, "p0", SetAutoDealIntent(type="SET_AUTO_DEAL", actionId="deal-1", autoDeal=True)
    )
    assert room.game_state is not None and room.game_state.auto_deal is True
    assert sockets["p1"].messages[-1]["events"] == [
        {"type": "AUTO_DEAL_CHANGED", "autoDeal": True}
    ]

    await manager.handle_intent(
        room, "p0", StartGameIntent(type="START_GAME", actionId="start-1")
    )
    assert room.game_state is not None
    assert room.game_state.phase == GamePhase.RACE_ROLL
    assert all(len(room.game_state.teams[player.id]) == 8 for player in players)
    assert room.public_state("p0")["game"]["autoDeal"] is True


@pytest.mark.anyio
async def test_only_the_host_can_toggle_auto_deal() -> None:
    engine = MagsimGameEngine(random.Random(6))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    socket = RecordingSocket()
    room = Room(
        id="TEST",
        engine=engine,
        game_state=engine.create_game(players),
        players={player.id: RoomPlayer(player, "token", socket=socket) for player in players},
    )

    await RoomManager(InMemoryRoomRepository()).handle_intent(
        room, "p1", SetAutoDealIntent(type="SET_AUTO_DEAL", actionId="deal-1", autoDeal=True)
    )

    assert socket.messages[-1]["code"] == "ONLY_HOST_CAN_CONFIGURE"
    assert room.game_state is not None and room.game_state.auto_deal is False


@pytest.mark.anyio
async def test_kick_requires_host_and_known_target() -> None:
    from magical_athlete.protocol import JoinRoomIntent, KickPlayerIntent

    class Socket(RecordingSocket):
        async def close(self, code=1000, reason="") -> None:
            pass

    repository = InMemoryRoomRepository()
    room = await repository.create(4)
    manager = RoomManager(repository)
    host, guest = Socket(), Socket()
    _, host_id = await manager.join(host, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Alice"))
    _, guest_id = await manager.join(guest, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Bob"))

    await manager.handle_intent(room, guest_id, KickPlayerIntent(
        type="KICK_PLAYER", actionId="guest-kick", targetPlayerId=host_id))
    assert guest.messages[-1]["code"] == "NOT_HOST"

    await manager.handle_intent(room, host_id, KickPlayerIntent(
        type="KICK_PLAYER", actionId="self-kick", targetPlayerId=host_id))
    assert host.messages[-1]["code"] == "CANNOT_KICK_SELF"

    await manager.handle_intent(room, host_id, KickPlayerIntent(
        type="KICK_PLAYER", actionId="ghost-kick", targetPlayerId="ghost"))
    assert host.messages[-1]["code"] == "PLAYER_NOT_FOUND"

    assert list(room.players) == [host_id, guest_id]


@pytest.mark.anyio
async def test_kick_after_start_keeps_player() -> None:
    from magical_athlete.protocol import KickPlayerIntent

    engine = MagsimGameEngine(random.Random(9))
    players = (Player("p0", "Alice"), Player("p1", "Bob"))
    sockets = {player.id: RecordingSocket() for player in players}
    room = Room(id="TEST", engine=engine,
                game_state=engine.start(engine.create_game(players), "p0").state,
                players={p.id: RoomPlayer(p, "token", socket=sockets[p.id]) for p in players})
    await RoomManager(InMemoryRoomRepository()).handle_intent(
        room, "p0", KickPlayerIntent(type="KICK_PLAYER", actionId="late", targetPlayerId="p1"))
    assert len(room.players) == 2
    assert sockets["p0"].messages[-1]["code"] == "GAME_ALREADY_STARTED"


async def _drive_host(
    manager: RoomManager, room: Room, host_id: str, counter: list[int]
) -> bool:
    """Play the human seat so a bot test can reach the end of the match."""

    def next_action_id() -> str:
        counter[0] += 1
        return f"host-{counter[0]}"

    state = room.game_state
    assert state is not None
    if state.phase in (GamePhase.DRAFT_ROLL, GamePhase.RACE_ROLL):
        if host_id in state.roll_candidates and host_id not in state.roll_values:
            await manager.handle_intent(
                room, host_id, RollStartIntent(type="ROLL_START", actionId=next_action_id())
            )
            return True
        return False
    if state.phase == GamePhase.DRAFTING:
        if state.active_player_id == host_id and state.draft_pool:
            await manager.handle_intent(room, host_id, DraftAthleteIntent(
                type="DRAFT_ATHLETE", actionId=next_action_id(),
                athleteId=state.draft_pool[0].id))
            return True
        return False
    if state.phase == GamePhase.CHARACTER_SELECTION:
        if host_id not in state.selections:
            team = [
                card.id for card in state.teams.get(host_id, ())
                if card.id not in state.used_athlete_ids
            ]
            count = room.engine.public_state(state, host_id)["selectionCount"]
            await manager.handle_intent(room, host_id, SelectRacersIntent(
                type="SELECT_RACERS", actionId=next_action_id(),
                athleteIds=tuple(team[:count])))
            return True
        return False
    if state.phase == GamePhase.RACING:
        decision = state.pending_decision
        if decision is not None:
            if decision["playerId"] == host_id:
                await manager.handle_intent(room, host_id, ResolveDecisionIntent(
                    type="RESOLVE_DECISION", actionId=next_action_id(),
                    decisionId=decision["id"],
                    optionId=str(decision["options"][-1]["id"])))
                return True
            return False
        pending_roll = state.pending_roll
        actor = pending_roll["nextPlayerId"] if pending_roll else state.active_player_id
        if actor == host_id:
            await manager.handle_intent(
                room, host_id, RollDiceIntent(type="ROLL_DICE", actionId=next_action_id())
            )
            return True
        return False
    if state.phase == GamePhase.RACE_RESULTS:
        await manager.handle_intent(
            room, host_id, AdvanceRaceIntent(type="ADVANCE_RACE", actionId=next_action_id())
        )
        return True
    return False


@pytest.mark.anyio
async def test_host_adds_a_bot_that_rolls_and_chooses_skills_on_its_own(monkeypatch) -> None:
    from magical_athlete import rooms as room_module
    from magical_athlete.protocol import AddBotIntent

    monkeypatch.setattr(room_module, "ROLL_ANIMATION_LEAD_SECONDS", 0)

    engine = MagsimGameEngine(random.Random(17))
    repository = InMemoryRoomRepository()
    room = await repository.create(4, engine)
    host_socket = RecordingSocket()
    host = Player("host", "Host")
    room.players = {"host": RoomPlayer(host, "token", socket=host_socket)}
    room.game_state = engine.create_game((host,))
    manager = RoomManager(repository, local_timers=False, rng=random.Random(4))

    await manager.handle_intent(room, "host", AddBotIntent(type="ADD_BOT", actionId="bot-1"))

    bot_ids = [player_id for player_id, member in room.players.items() if member.is_bot]
    assert len(bot_ids) == 1
    bot_id = bot_ids[0]
    assert room.public_state("host")["game"]["players"][1]["isBot"] is True
    assert room.players[bot_id].socket is None

    await manager.handle_intent(room, "host", StartGameIntent(type="START_GAME", actionId="start"))
    assert room.bot_deadline is not None

    counter = [0]
    for _ in range(4000):
        state = room.game_state
        assert state is not None
        if state.phase == GamePhase.FINISHED:
            break
        if room.bot_deadline is not None:
            assert await manager.resolve_bot_action(
                room, room.bot_deadline + timedelta(seconds=1)
            )
            continue
        if await _drive_host(manager, room, "host", counter):
            continue
        raise AssertionError(f"match stalled in {state.phase}")

    state = room.game_state
    assert state is not None and state.phase == GamePhase.FINISHED

    events = [event for message in host_socket.messages for event in message.get("events", [])]
    bot_rolls = [
        event for event in events
        if event["type"] in ("DIE_ROLLED", "ABILITY_DICE_ROLLED", "DICE_ROLLED", "START_DICE_ROLLED")
        and event.get("playerId") == bot_id
    ]
    assert bot_rolls
    bot_decisions = [
        event for event in events
        if event["type"] == "DECISION_RESOLVED" and event.get("bot") and event.get("playerId") == bot_id
    ]
    assert bot_decisions
    # A bot's smart choice reports the concrete option the table should see.
    assert all(event.get("optionLabel") for event in bot_decisions)
    assert any(event.get("optionId") for event in bot_decisions)


@pytest.mark.anyio
async def test_only_the_host_adds_bots_and_only_before_the_game_starts() -> None:
    from magical_athlete.protocol import AddBotIntent, JoinRoomIntent

    repository = InMemoryRoomRepository()
    room = await repository.create(4)
    manager = RoomManager(repository)
    host, guest = RecordingSocket(), RecordingSocket()
    _, host_id = await manager.join(host, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Alice"))
    _, guest_id = await manager.join(guest, JoinRoomIntent(
        type="JOIN_ROOM", roomId=room.id, playerName="Bob"))

    await manager.handle_intent(room, guest_id, AddBotIntent(type="ADD_BOT", actionId="guest-bot"))
    assert guest.messages[-1]["code"] == "NOT_HOST"
    assert len(room.players) == 2

    await manager.handle_intent(room, host_id, AddBotIntent(type="ADD_BOT", actionId="host-bot"))
    assert len(room.players) == 3
    bot_id = next(pid for pid, member in room.players.items() if member.is_bot)
    assert room.public_state(host_id)["game"]["players"][-1]["isBot"] is True

    await manager.handle_intent(room, host_id, KickPlayerIntent(
        type="KICK_PLAYER", actionId="kick-bot", targetPlayerId=bot_id))
    assert bot_id not in room.players
    await manager.handle_intent(room, host_id, AddBotIntent(type="ADD_BOT", actionId="host-bot-2"))
    assert len(room.players) == 3

    await manager.handle_intent(room, host_id, StartGameIntent(type="START_GAME", actionId="start"))
    await manager.handle_intent(room, host_id, AddBotIntent(type="ADD_BOT", actionId="late-bot"))
    assert host.messages[-1]["code"] == "GAME_ALREADY_STARTED"
    assert len(room.players) == 3


@pytest.mark.anyio
async def test_bot_turn_waits_for_the_delay_then_stops_when_no_bot_owes_an_action(monkeypatch) -> None:
    from magical_athlete import rooms as room_module
    from magical_athlete.protocol import AddBotIntent

    monkeypatch.setattr(room_module, "ROLL_ANIMATION_LEAD_SECONDS", 0)

    engine = MagsimGameEngine(random.Random(2))
    repository = InMemoryRoomRepository()
    room = await repository.create(4, engine)
    host_socket = RecordingSocket()
    host = Player("host", "Host")
    room.players = {"host": RoomPlayer(host, "token", socket=host_socket)}
    room.game_state = engine.create_game((host,))
    manager = RoomManager(repository, local_timers=False, rng=random.Random(1))

    await manager.handle_intent(room, "host", AddBotIntent(type="ADD_BOT", actionId="bot-1"))
    await manager.handle_intent(room, "host", StartGameIntent(type="START_GAME", actionId="start"))
    deadline = room.bot_deadline
    assert deadline is not None

    # The bot only acts once its delay elapsed.
    assert await manager.resolve_bot_action(room, deadline - timedelta(seconds=1)) is False
    assert await manager.resolve_bot_action(room, deadline + timedelta(seconds=1)) is True

    # The human seat still has to act, so no bot obligation remains queued.
    assert room.bot_deadline is None


@pytest.mark.anyio
async def test_bot_acts_through_the_background_timer_used_by_the_local_server(monkeypatch) -> None:
    import asyncio

    from magical_athlete import rooms as room_module
    from magical_athlete.protocol import AddBotIntent

    monkeypatch.setattr(room_module, "ROLL_ANIMATION_LEAD_SECONDS", 0)
    monkeypatch.setattr(room_module, "BOT_ACTION_DELAY_SECONDS", 0.01)

    engine = MagsimGameEngine(random.Random(11))
    repository = InMemoryRoomRepository()
    room = await repository.create(4, engine)
    host_socket = RecordingSocket()
    host = Player("host", "Host")
    room.players = {"host": RoomPlayer(host, "token", socket=host_socket)}
    room.game_state = engine.create_game((host,))
    manager = RoomManager(repository, rng=random.Random(2))

    await manager.handle_intent(room, "host", AddBotIntent(type="ADD_BOT", actionId="bot-1"))
    bot_id = next(pid for pid, member in room.players.items() if member.is_bot)
    await manager.handle_intent(room, "host", StartGameIntent(type="START_GAME", actionId="start"))

    for _ in range(100):
        await asyncio.sleep(0.02)
        if room.game_state is not None and bot_id in room.game_state.roll_values:
            break
    if room.bot_task is not None:
        room.bot_task.cancel()

    assert room.game_state is not None
    assert room.game_state.roll_values.get(bot_id)
    assert any(
        event["type"] == "START_DICE_ROLLED" and event.get("playerId") == bot_id
        for message in host_socket.messages
        for event in message.get("events", [])
    )
