from magsim.core.events import MoveCmdEvent, Phase
from magsim.engine.movement import handle_move_cmd
from magsim.engine.scenario import GameScenario, RacerConfig


def _move(racer_idx: int, distance: int) -> MoveCmdEvent:
    return MoveCmdEvent(
        target_racer_idx=racer_idx,
        distance=distance,
        source="System",
        phase=Phase.MOVE_EXEC,
        responsible_racer_idx=None,
    )


def test_duelist_does_not_retrigger_from_unrelated_move_while_already_sharing() -> None:
    scenario = GameScenario(
        [
            RacerConfig(0, "Duelist", start_pos=2),
            RacerConfig(1, "Legs", start_pos=2),
            RacerConfig(2, "Banana", start_pos=0),
        ],
        dice_rolls=[6, 1],
        defer_setup=True,
    )

    handle_move_cmd(scenario.engine, _move(racer_idx=2, distance=1))

    assert all(
        getattr(scheduled.event, "source", None) != "DuelistDuel"
        for scheduled in scenario.engine.state.queue
    )


def test_duelist_triggers_when_racer_moves_onto_duelist_space() -> None:
    scenario = GameScenario(
        [
            RacerConfig(0, "Duelist", start_pos=2),
            RacerConfig(1, "Legs", start_pos=0),
        ],
        dice_rolls=[6, 1],
        defer_setup=True,
    )

    handle_move_cmd(scenario.engine, _move(racer_idx=1, distance=2))

    assert any(
        getattr(scheduled.event, "source", None) == "DuelistDuel"
        for scheduled in scenario.engine.state.queue
    )
