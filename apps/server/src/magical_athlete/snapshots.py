from __future__ import annotations

import pickle
from dataclasses import dataclass
from datetime import datetime

from .game import GameState, Player

SCHEMA_VERSION = 4


class IncompatibleSnapshotError(ValueError):
    pass


@dataclass(slots=True)
class SnapshotPlayer:
    player: Player
    reconnect_token: str
    seen_action_ids: set[str]
    is_bot: bool = False


@dataclass(slots=True)
class RoomSnapshot:
    room_id: str
    players: dict[str, SnapshotPlayer]
    game_state: GameState | None
    revision: int
    decision_deadline: datetime | None
    roll_deadline: datetime | None
    last_active_at: datetime
    bot_deadline: datetime | None = None


def encode_snapshot(snapshot: RoomSnapshot) -> bytes:
    return pickle.dumps({"schemaVersion": SCHEMA_VERSION, "snapshot": snapshot}, protocol=5)


def decode_snapshot(data: bytes) -> RoomSnapshot:
    payload = pickle.loads(data)  # noqa: S301 - storage contains server-generated data only.
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        version = payload.get("schemaVersion") if isinstance(payload, dict) else None
        raise IncompatibleSnapshotError(f"unsupported room snapshot schema: {version!r}")
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, RoomSnapshot):
        raise IncompatibleSnapshotError("invalid room snapshot payload")
    return snapshot
