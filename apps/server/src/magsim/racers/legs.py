from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar, Self, override

from magsim.ai.evaluation import (
    get_benefit_at,
    get_current_modifiers,
    get_hazard_at,
)
from magsim.core.abilities import Ability
from magsim.core.agent import (
    Agent,
    SelectionDecisionContext,
    SelectionDecisionMixin,
    SelectionInteractive,
)
from magsim.core.events import GameEvent

if TYPE_CHECKING:
    from magsim.core.state import ActiveRacerState
    from magsim.core.types import AbilityName
    from magsim.engine.game_engine import GameEngine


@dataclass
class LegsMoveAbility(Ability, SelectionDecisionMixin[int]):
    name: AbilityName = "LongLegs"
    triggers: tuple[type[GameEvent], ...] = ()
    choice_type: ClassVar[str] = "DIE"

    def choose_roll(
        self,
        event: GameEvent,
        owner: ActiveRacerState,
        engine: GameEngine,
        agent: Agent,
        values: tuple[int, ...],
    ) -> int:
        return agent.make_selection_decision(
            engine,
            SelectionDecisionContext[SelectionInteractive[int], int](
                source=self,
                event=event,
                game_state=engine.state,
                source_racer_idx=owner.idx,
                options=values,
            ),
        )

    @override
    def get_baseline_selection_decision(
        self,
        engine: GameEngine,
        ctx: SelectionDecisionContext[Self, int],
    ) -> int | None:
        return max(ctx.options, default=None)

    @override
    def get_auto_selection_decision(
        self,
        engine: GameEngine,
        ctx: SelectionDecisionContext[Self, int],
    ) -> int | None:
        if (me := engine.get_active_racer(ctx.source_racer_idx)) is None:
            return max(ctx.options, default=None)
        mods = get_current_modifiers(engine, me.idx)

        def score(value: int) -> tuple[bool, bool, int]:
            destination = me.position + value + mods
            return (
                get_benefit_at(engine, destination) is not None,
                get_hazard_at(engine, destination) is None,
                value,
            )

        return max(ctx.options, key=score, default=None)
