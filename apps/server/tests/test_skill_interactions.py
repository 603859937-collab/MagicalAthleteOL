"""Small reproductions of surprising behavior found during offline race probes."""
from magsim.core.events import MoveCmdEvent, Phase
from magsim.engine.movement import handle_move_cmd
from magsim.engine.scenario import GameScenario, RacerConfig


def move(scenario, racer, distance):
    handle_move_cmd(scenario.engine, MoveCmdEvent(
        target_racer_idx=racer, distance=distance, source='System',
        phase=Phase.MOVE_EXEC, responsible_racer_idx=racer,
    ))


def test_mouth_eliminates_single_victim_instead_of_carrying_them():
    scenario = GameScenario([
        RacerConfig(0, 'Mouth', start_pos=1),
        RacerConfig(1, 'Coach', start_pos=3),
        RacerConfig(2, 'Legs', start_pos=8),
    ], seed=0)
    move(scenario, 0, 2)
    victim = scenario.engine.get_racer(1)
    assert victim.eliminated
    assert victim.position is None
    assert not victim.abilities


def test_mouth_does_not_swallow_a_group_of_two():
    scenario = GameScenario([
        RacerConfig(0, 'Mouth', start_pos=1),
        RacerConfig(1, 'Coach', start_pos=3),
        RacerConfig(2, 'Legs', start_pos=3),
    ], seed=0)
    move(scenario, 0, 2)
    assert all(not racer.eliminated for racer in scenario.engine.state.racers)


def test_romantic_reacts_to_two_other_racers_meeting_far_away():
    scenario = GameScenario([
        RacerConfig(0, 'Romantic', start_pos=0),
        RacerConfig(1, 'Coach', start_pos=8),
        RacerConfig(2, 'Legs', start_pos=10),
    ], seed=0)
    move(scenario, 1, 2)
    reactions = [item.event for item in scenario.engine.state.queue
                 if isinstance(item.event, MoveCmdEvent) and item.event.source == 'RomanticMove']
    assert len(reactions) == 1
    assert reactions[0].target_racer_idx == 0
    assert reactions[0].distance == 2
