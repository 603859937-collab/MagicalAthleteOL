from datetime import UTC, datetime

import pytest

from magical_athlete.game import MagsimGameEngine, Player
from magical_athlete.snapshots import (
    IncompatibleSnapshotError,
    RoomSnapshot,
    SnapshotPlayer,
    decode_snapshot,
    encode_snapshot,
)


def test_snapshot_round_trip_preserves_game_and_action_deduplication() -> None:
    engine = MagsimGameEngine()
    players = (Player("p1", "Alice"), Player("p2", "Bob"))
    state = engine.create_game(players)
    snapshot = RoomSnapshot(
        room_id="ABCD",
        players={
            "p1": SnapshotPlayer(players[0], "secret", {"start-1", "roll-1"}, is_bot=True),
            "p2": SnapshotPlayer(players[1], "secret-2", set()),
        },
        game_state=state,
        revision=7,
        decision_deadline=None,
        roll_deadline=None,
        last_active_at=datetime.now(UTC),
    )

    restored = decode_snapshot(encode_snapshot(snapshot))

    assert restored.room_id == "ABCD"
    assert restored.revision == 7
    assert restored.game_state == state
    assert restored.players["p1"].seen_action_ids == {"start-1", "roll-1"}
    assert restored.players["p1"].is_bot is True
    assert restored.players["p2"].is_bot is False
    assert restored.bot_deadline is None


def test_unknown_snapshot_schema_is_rejected() -> None:
    import pickle

    with pytest.raises(IncompatibleSnapshotError):
        decode_snapshot(pickle.dumps({"schemaVersion": 999, "snapshot": None}))


def test_existing_room_upgrades_genius_prediction_subscriptions() -> None:
    import random
    from dataclasses import replace
    from magical_athlete.athletes import ATHLETE_BY_ID
    from magical_athlete.game import GamePhase
    from magsim.core.events import RollModificationWindowEvent, RollResultEvent, TurnStartEvent

    engine = MagsimGameEngine(random.Random(3))
    players = tuple(Player(f'p{i}', f'Player {i}') for i in range(3))
    ids = ['genius', 'coach', 'banana']
    state = replace(engine.create_game(players), phase=GamePhase.CHARACTER_SELECTION,
                    first_turn_player_id='p0', teams={p.id: (ATHLETE_BY_ID[a],) for p, a in zip(players, ids)})
    for player, athlete in zip(players, ids):
        state = engine.select_racers(state, player.id, (athlete,)).state
    decision = state.pending_decision
    state = engine.resolve_decision(state, 'p0', decision['id'], '4').state  # predict 5
    ability = state.magsim_engine.get_racer(0).active_abilities[0]
    ability.triggers = (TurnStartEvent, RollModificationWindowEvent)
    state.magsim_engine._rebuild_subscribers()
    snapshot = RoomSnapshot('TEST', {}, state, 9, None, None, datetime.now(UTC))

    restored = decode_snapshot(encode_snapshot(snapshot))
    rules = restored.game_state.magsim_engine
    assert rules.get_racer(0).active_abilities[0].triggers == (TurnStartEvent, RollResultEvent)
    rules.rng.randint = lambda *_: 5
    transition = engine.roll_dice(restored.game_state, 'p0')
    roll = next(e for e in transition.events if e['type'] == 'DICE_ROLLED')
    assert roll['value'] == 5 and roll['finalValue'] == 6
    assert transition.state.active_player_id == 'p0'
    assert transition.state.pending_decision['abilityName'] == 'GeniusPrediction'
