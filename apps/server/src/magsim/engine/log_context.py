from __future__ import annotations

import logging
from typing import TYPE_CHECKING, override

if TYPE_CHECKING:
    from magsim.engine.game_engine import GameEngine


class ContextFilter(logging.Filter):
    """Inject per-engine runtime context into every log record."""

    def __init__(self, engine: GameEngine, name: str = "") -> None:
        super().__init__(name)
        self.engine = engine

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        logctx = self.engine.log_context
        record.total_turn = logctx.total_turn
        record.turn_log_count = logctx.turn_log_count
        record.racer_repr = logctx.current_racer_repr
        record.engine_id = logctx.engine_id
        record.engine_level = logctx.engine_level
        logctx.inc_log_count()
        return True
