"""Rulebook pages 21–25: stopping, moving, warping, and simultaneous arrivals."""
import pytest

from magsim.ai.baseline_agent import BaselineAgent
from magsim.core.events import MoveCmdEvent, Phase, PostMoveEvent, WarpCmdEvent
from magsim.engine.game_engine import TurnProgress
from magsim.engine.movement import handle_move_cmd, handle_warp_cmd
from magsim.engine.scenario import GameScenario, RacerConfig


def move(scenario, idx, distance):
    handle_move_cmd(scenario.engine, MoveCmdEvent(
        target_racer_idx=idx, distance=distance, source='System',
        phase=Phase.MOVE_EXEC, responsible_racer_idx=idx,
    ))


def warp(scenario, idx, target):
    handle_warp_cmd(scenario.engine, WarpCmdEvent(
        target_racer_idx=idx, target_tile=target, source='System',
        phase=Phase.MOVE_EXEC, responsible_racer_idx=idx,
    ))


def reactions(scenario, source):
    return [item.event for item in scenario.engine.state.queue
            if isinstance(item.event, MoveCmdEvent) and item.event.source == source]


def test_party_animal_simultaneous_pair_triggers_romantic_twice():
    scenario = GameScenario([
        RacerConfig(0, 'PartyAnimal', start_pos=10),
        RacerConfig(1, 'Romantic', start_pos=0),
        RacerConfig(2, 'Coach', start_pos=6),
        RacerConfig(3, 'Legs', start_pos=6),
    ], seed=0)
    recorded = []
    scenario.engine.on_event_processed = lambda _, event: recorded.append(event)
    scenario.engine.start_turn()
    assert scenario.engine.continue_turn() is TurnProgress.WAITING_FOR_ROLL
    romantic_moves = [e for e in recorded if isinstance(e, PostMoveEvent) and e.source == 'RomanticMove']
    assert len(romantic_moves) == 2
    assert [(e.start_tile, e.end_tile) for e in romantic_moves] == [(1, 3), (3, 5)]
    assert scenario.get_racer(2).position == scenario.get_racer(3).position == 7


@pytest.mark.parametrize('arrival', [move, warp], ids=['move', 'warp'])
def test_romantic_can_react_while_tripped(arrival):
    scenario = GameScenario([
        RacerConfig(0, 'Romantic'), RacerConfig(1, 'Coach', start_pos=5),
        RacerConfig(2, 'Legs', start_pos=7),
    ], seed=0)
    scenario.get_racer(0).tripped = True
    arrival(scenario, 1, 2 if arrival is move else 7)
    assert len(reactions(scenario, 'RomanticMove')) == 1
    assert scenario.get_racer(0).tripped


def test_third_arrival_does_not_trigger_romantic():
    scenario = GameScenario([
        RacerConfig(0, 'Romantic'), RacerConfig(1, 'Coach', start_pos=7),
        RacerConfig(2, 'Legs', start_pos=7), RacerConfig(3, 'ThirdWheel', start_pos=1),
    ], seed=0)
    warp(scenario, 3, 7)
    assert not reactions(scenario, 'RomanticMove')


@pytest.mark.parametrize('arrival', [move, warp], ids=['move', 'warp'])
def test_suckerfish_follows_moves_but_not_warps(arrival):
    scenario = GameScenario([
        RacerConfig(0, 'Suckerfish', start_pos=5, agent=BaselineAgent()),
        RacerConfig(1, 'Coach', start_pos=5), RacerConfig(2, 'Romantic'),
    ], seed=0)
    arrival(scenario, 1, 2 if arrival is move else 7)
    follow = reactions(scenario, 'SuckerfishRide')
    assert len(follow) == (1 if arrival is move else 0)
    if follow:
        handle_move_cmd(scenario.engine, follow[0])
        assert scenario.get_racer(0).position == 7
        assert len(reactions(scenario, 'RomanticMove')) == 1


def test_suckerfish_does_not_follow_someone_passing_it():
    scenario = GameScenario([
        RacerConfig(0, 'Suckerfish', start_pos=5, agent=BaselineAgent()),
        RacerConfig(1, 'Coach', start_pos=3),
    ], seed=0)
    move(scenario, 1, 4)
    assert not reactions(scenario, 'SuckerfishRide')


def test_zero_move_does_not_retrigger_a_pair():
    scenario = GameScenario([
        RacerConfig(0, 'Romantic'), RacerConfig(1, 'Coach', start_pos=7),
        RacerConfig(2, 'Legs', start_pos=7),
    ], seed=0)
    move(scenario, 1, 0)
    assert not reactions(scenario, 'RomanticMove')
