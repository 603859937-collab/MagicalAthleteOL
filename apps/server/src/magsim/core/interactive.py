from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, override
from uuid import uuid4

from magsim.core.agent import Agent, DecisionContext, SelectionDecisionContext


class DecisionRequired(Exception):
    """Control-flow signal used to pause resolution at an interactive choice."""


def _choice_label(value: Any) -> str:
    for attribute in ("racer_name", "name", "repr"):
        label = getattr(value, attribute, None)
        if label:
            return str(label)
    return str(value)


@dataclass(slots=True)
class PendingChoice:
    id: str
    racer_idx: int
    ability_name: str
    prompt: str
    choice_type: str
    options: tuple[Any, ...]
    option_labels: tuple[str, ...]
    roll_preview: dict[str, int] | None = None
    answer_index: int | None = None
    auto_answer: bool = False

    def public_options(self) -> list[dict[str, str]]:
        return [
            {"id": str(index), "label": label}
            for index, label in enumerate(self.option_labels)
        ]


@dataclass(slots=True)
class DecisionBroker:
    pending: PendingChoice | None = None
    last_resolved: PendingChoice | None = None

    def request(
        self,
        ctx: DecisionContext[Any],
        options: tuple[Any, ...],
        labels: tuple[str, ...],
        choice_type: str,
    ) -> Any:
        ability_name = str(getattr(ctx.source, "name", type(ctx.source).__name__))
        signature = (ctx.source_racer_idx, ability_name, choice_type)
        if self.pending is None:
            roll_state = ctx.game_state.roll_state
            roll_serial = getattr(ctx.event, "roll_serial", None)
            roll_preview = None
            if roll_serial is not None and getattr(ctx.event, "current_roll_val", None) is not None:
                roll_preview = {
                    "rollSerial": roll_serial,
                    "value": roll_state.dice_value or roll_state.base_value,
                    "baseValue": roll_state.base_value,
                    "finalValue": roll_state.final_value,
                }
            self.pending = PendingChoice(
                id=uuid4().hex,
                racer_idx=ctx.source_racer_idx,
                ability_name=ability_name,
                prompt=f"请选择 {ability_name} 的效果",
                choice_type=choice_type,
                options=options,
                option_labels=labels,
                roll_preview=roll_preview,
            )
            raise DecisionRequired

        current = self.pending
        if signature != (current.racer_idx, current.ability_name, current.choice_type):
            raise DecisionRequired
        if current.answer_index is None:
            raise DecisionRequired

        index = current.answer_index
        if index == -2:
            self.last_resolved = current
            self.pending = None
            return None
        auto = current.auto_answer
        resolved = PendingChoice(
            id=current.id,
            racer_idx=current.racer_idx,
            ability_name=current.ability_name,
            prompt=current.prompt,
            choice_type=current.choice_type,
            options=options,
            option_labels=labels,
            roll_preview=current.roll_preview,
            answer_index=index,
            auto_answer=auto,
        )
        self.last_resolved = resolved
        self.pending = None
        return options[index]

    def choose(self, decision_id: str, option_id: str) -> PendingChoice:
        pending = self.pending
        if pending is None or pending.id != decision_id:
            raise ValueError("STALE_DECISION")
        try:
            index = int(option_id)
        except ValueError as error:
            raise ValueError("INVALID_DECISION_OPTION") from error
        if not 0 <= index < len(pending.options):
            raise ValueError("INVALID_DECISION_OPTION")
        pending.answer_index = index
        return pending

    def choose_smart(self, engine: Any) -> PendingChoice:
        pending = self.pending
        if pending is None:
            raise ValueError("NO_PENDING_DECISION")
        source = pending.options  # Keep the public pending object stable while evaluating.
        _ = source
        # Replaying with this marker lets the interactive agent evaluate against the
        # restored engine and context, rather than stale objects from the first attempt.
        pending.answer_index = -1
        pending.auto_answer = True
        return pending


@dataclass(slots=True)
class InteractiveAgent(Agent):
    broker: DecisionBroker = field(default_factory=DecisionBroker)

    def __deepcopy__(self, memo: dict[int, Any]) -> InteractiveAgent:
        # The broker is an out-of-transaction control channel. Engine rollback must
        # not erase the pending choice or a submitted answer.
        return self

    @override
    def make_boolean_decision(self, engine: Any, ctx: DecisionContext[Any]) -> bool:
        pending = self.broker.pending
        if pending is not None and pending.answer_index == -1:
            result = ctx.source.get_auto_boolean_decision(engine, ctx)
            pending.answer_index = 1 if result else 0
        return bool(
            self.broker.request(
                ctx,
                (False, True),
                ("不使用", "使用"),
                "BOOLEAN",
            )
        )

    @override
    def make_selection_decision(self, engine: Any, ctx: SelectionDecisionContext[Any, Any]) -> Any:
        options = tuple(ctx.options)
        if not options:
            return None
        pending = self.broker.pending
        if pending is not None and pending.answer_index == -1:
            recommended = ctx.source.get_auto_selection_decision(engine, ctx)
            if recommended is None:
                pending.answer_index = -2
                return self.broker.request(
                    ctx, options, tuple(_choice_label(option) for option in options), pending.choice_type
                )
            try:
                pending.answer_index = options.index(recommended)
            except ValueError:
                pending.answer_index = 0
        choice_type = "RACER"
        if options and all(isinstance(option, int) for option in options):
            choice_type = "DIE" if "Genius" in str(getattr(ctx.source, "name", "")) else "TILE"
        return self.broker.request(
            ctx,
            options,
            tuple(_choice_label(option) for option in options),
            choice_type,
        )
