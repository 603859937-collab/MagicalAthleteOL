from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Self, override

from magsim.core.abilities import Ability
from magsim.core.agent import (
    SelectionDecisionContext,
    SelectionDecisionMixin,
    SelectionInteractive,
)
from magsim.core.events import (
    AbilityRollResultEvent,
    AbilityTriggeredEventOrSkipped,
    GameEvent,
    Phase,
    PostMoveEvent,
    PostWarpEvent,
    TurnStartEvent,
)
from magsim.core.mixins import LifecycleManagedMixin
from magsim.core.state import ActiveRacerState
from magsim.core.types import RacerName, RacerStat
from magsim.engine.movement import push_move
from magsim.racers import get_all_racer_stats

if TYPE_CHECKING:
    from magsim.core.agent import Agent
    from magsim.core.types import AbilityName
    from magsim.engine.game_engine import GameEngine


@dataclass
class DuelistAbility(
    Ability,
    SelectionDecisionMixin[ActiveRacerState],
    LifecycleManagedMixin,
):
    name: AbilityName = "DuelistDuel"
    triggers: tuple[type[GameEvent], ...] = (
        TurnStartEvent,
        PostMoveEvent,
        PostWarpEvent,
    )

    @override
    def on_gain(self, engine: GameEngine, owner_idx: int) -> None:
        """
        Check for a duel immediately upon gaining the ability (e.g., Copycat).
        GUARD: Only if the race is active (skips Setup Phase).
        """
        if (
            not engine.state.race_active
            or (owner := engine.get_active_racer(owner_idx)) is None
        ):
            return
        agent = engine.get_agent(owner_idx)

        # Trigger logic with a synthetic phase name
        self._check_and_run_duel(engine, owner, agent, phase=Phase.PRE_MAIN)

    @override
    def on_loss(self, engine: GameEngine, owner_idx: int) -> None:
        return

    @override
    def execute(
        self,
        event: GameEvent,
        owner: ActiveRacerState,
        engine: GameEngine,
        agent: Agent,
    ) -> AbilityTriggeredEventOrSkipped:
        # 1. Validation Logic
        if (
            not isinstance(event, (TurnStartEvent, PostMoveEvent, PostWarpEvent))
            or not engine.get_racer(event.target_racer_idx).active
        ):
            return "skip_trigger"

        return self._check_and_run_duel(engine, owner, agent, event.phase, event)

    def _check_and_run_duel(
        self,
        engine: GameEngine,
        owner: ActiveRacerState,
        agent: Agent,
        phase: Phase,
        event: GameEvent | None = None,
    ) -> AbilityTriggeredEventOrSkipped:
        # skip if duel already triggered of this event to avoid Copycat double trigger
        if (
            current_schedule := engine.current_processing_event
        ) is not None and self.name in current_schedule.locked_abilities:
            return "skip_trigger"

        if isinstance(event, (PostMoveEvent, PostWarpEvent)):
            event_racer = engine.get_racer(event.target_racer_idx)
            if event.target_racer_idx != owner.idx and (
                not event_racer.active or event_racer.position != owner.position
            ):
                return "skip_trigger"

        targets = engine.get_racers_at_position(
            owner.position,
            except_racer_idx=owner.idx,
        )

        if not targets:
            return "skip_trigger"

        target = agent.make_selection_decision(
            engine,
            ctx=SelectionDecisionContext[
                SelectionInteractive[ActiveRacerState],
                ActiveRacerState,
            ](
                source=self,
                event=None,  # Optional context, often None for direct calls
                game_state=engine.state,
                source_racer_idx=owner.idx,
                options=targets,
            ),
        )

        if target is None:
            engine.log_info(
                f"{owner.repr} decided not to use {self.name}!",
            )
            return "skip_trigger"

        # 3. Execute Duel
        engine.log_info(
            f"{owner.repr} challenges {target.repr} to a {self.name}!",
        )

        scheduled_serial = (
            engine.current_processing_event.serial
            if engine.current_processing_event is not None
            else engine.state.serial
        )
        completed_roll = engine.request_roll_sequence(
            key=("duel", scheduled_serial, owner.idx, target.idx),
            kind="ABILITY_ROLL",
            participants=(owner.idx, target.idx),
            ability_name=self.name,
        )
        owner_roll, target_roll = completed_roll.values
        winner = owner if owner_roll >= target_roll else target
        engine.log_info(
            f"{self.name}: {owner.repr} rolls a {owner_roll}, {target.repr} rolls a {target_roll} - {winner.repr} wins!",
        )

        engine.push_event(
            AbilityRollResultEvent(
                responsible_racer_idx=owner.idx,
                source=self.name,
                phase=phase,
                participant_racer_indices=(owner.idx, target.idx),
                values=completed_roll.values,
                winner_racer_idx=winner.idx,
                roll_session_id=completed_roll.id,
            ),
        )

        push_move(
            engine,
            distance=2,
            phase=phase,
            moved_racer_idx=winner.idx,
            source=self.name,
            responsible_racer_idx=owner.idx,
            emit_ability_triggered="immediately",
        )

        # 4. Add lock on event
        if engine.current_processing_event is not None:
            engine.current_processing_event.locked_abilities.add(self.name)

        return "skip_trigger"

    @override
    def get_baseline_selection_decision(
        self,
        engine: GameEngine,
        ctx: SelectionDecisionContext[Self, ActiveRacerState],
    ) -> ActiveRacerState | None:
        """Auto-Strategy: Always duel."""
        if not ctx.options:
            return None
        # Deterministic tie-breaker: pick highest ID
        return max(ctx.options, key=lambda r: r.idx)

    @override
    def get_auto_selection_decision(
        self,
        engine: GameEngine,
        ctx: SelectionDecisionContext[Self, ActiveRacerState],
    ) -> ActiveRacerState | None:
        candidates: list[RacerStat] = [
            stats
            for name, stats in get_all_racer_stats().items()
            if name in [r.name for r in ctx.options]
        ]
        highest_winrate_racer: RacerName = min(
            candidates,
            key=lambda r: r.winrate,
        ).racer_name
        return next(r for r in ctx.options if r.name == highest_winrate_racer)
