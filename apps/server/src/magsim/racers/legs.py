from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Self, override

from magsim.ai.evaluation import (
    get_benefit_at,
    get_current_modifiers,
    get_hazard_at,
)
from magsim.core.abilities import Ability
from magsim.core.agent import (
    Agent,
    BooleanDecisionMixin,
    BooleanInteractive,
    DecisionContext,
)
from magsim.core.events import (
    AbilityTriggeredEvent,
    AbilityTriggeredEventOrSkipped,
    GameEvent,
    TurnStartEvent,
)

if TYPE_CHECKING:
    from magsim.core.state import ActiveRacerState
    from magsim.core.types import AbilityName
    from magsim.engine.game_engine import GameEngine

# Rulebook "Jog": the skipped roll is replaced by this flat distance. It still
# counts as the main move, so Gunk's -1 and Coach's +1 apply on top of it.
JOG_DISTANCE = 5


@dataclass
class LegsMoveAbility(Ability, BooleanDecisionMixin):
    name: AbilityName = "LongLegs"
    triggers: tuple[type[GameEvent], ...] = (TurnStartEvent,)

    @override
    def execute(
        self,
        event: GameEvent,
        owner: ActiveRacerState,
        engine: GameEngine,
        agent: Agent,
    ) -> AbilityTriggeredEventOrSkipped:
        if (
            not isinstance(event, TurnStartEvent)
            or event.target_racer_idx != owner.idx
            or owner.main_move_consumed
        ):
            return "skip_trigger"

        ctx = DecisionContext[BooleanInteractive](
            source=self,
            event=event,
            game_state=engine.state,
            source_racer_idx=owner.idx,
        )
        if not agent.make_boolean_decision(engine, ctx):
            return "skip_trigger"

        # Consumed by handle_perform_main_roll: no die is rolled for this move.
        owner.roll_override = (self.name, JOG_DISTANCE)
        return AbilityTriggeredEvent(
            responsible_racer_idx=owner.idx,
            source=self.name,
            phase=event.phase,
            target_racer_idx=owner.idx,
        )

    @override
    def get_baseline_boolean_decision(
        self,
        engine: GameEngine,
        ctx: DecisionContext[Self],
    ) -> bool:
        return True

    @override
    def get_auto_boolean_decision(
        self,
        engine: GameEngine,
        ctx: DecisionContext[Self],
    ) -> bool:
        if (me := engine.get_active_racer(ctx.source_racer_idx)) is None:
            return True

        # 5 is above the 3.5 average, so jogging is the default; only skip it
        # when the landing tile is a hazard and not a prize.
        mods = get_current_modifiers(engine, me.idx)
        target = me.position + JOG_DISTANCE + mods

        if benefit := get_benefit_at(engine, target):
            engine.log_info(f"{me.repr} jogs to {benefit} using {self.name}!")
            return True

        if hazard := get_hazard_at(engine, target):
            engine.log_info(f"{me.repr} declines {self.name} because of {hazard}!")
            return False

        return True
