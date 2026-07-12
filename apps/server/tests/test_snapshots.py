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
            "p1": SnapshotPlayer(players[0], "secret", {"start-1", "roll-1"}),
            "p2": SnapshotPlayer(players[1], "secret-2", set()),
        },
        game_state=state,
        revision=7,
        decision_deadline=None,
        last_active_at=datetime.now(UTC),
    )

    restored = decode_snapshot(encode_snapshot(snapshot))

    assert restored.room_id == "ABCD"
    assert restored.revision == 7
    assert restored.game_state == state
    assert restored.players["p1"].seen_action_ids == {"start-1", "roll-1"}


def test_unknown_snapshot_schema_is_rejected() -> None:
    import pickle

    with pytest.raises(IncompatibleSnapshotError):
        decode_snapshot(pickle.dumps({"schemaVersion": 999, "snapshot": None}))
