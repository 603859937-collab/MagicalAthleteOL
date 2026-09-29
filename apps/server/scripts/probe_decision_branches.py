"""Exercise every offered option from persisted, isolated pending-choice states."""
import json
import pickle
import random
from collections import Counter
from dataclasses import replace

from magical_athlete.athletes import ATHLETE_BY_ID
from magical_athlete.game import GamePhase, GameRuleError, MagsimGameEngine, Player

LINEUPS = [
    ('egg', 'twin', 'copycat', 'mastermind'),
    ('alchemist', 'rocket_scientist', 'magician', 'dicemonger'),
    ('duelist', 'suckerfish', 'hypnotist', 'flip_flop'),
    ('genius', 'legs', 'cheerleader', 'third_wheel'),
]
EXPECTED = {'EggCopy', 'TwinCopy', 'CopyLead', 'MastermindPredict',
            'AlchemistAlchemy', 'RocketScientistBoost', 'MagicalReroll', 'DicemongerDeal',
            'DuelistDuel', 'SuckerfishRide', 'HypnotistWarp', 'FlipFlopSwap',
            'GeniusPrediction', 'LongLegs', 'CheerleaderSupport', 'ThirdWheelJoin'}


def advance(engine, state, option=None, auto=False):
    choice = state.pending_decision
    if choice:
        return engine.resolve_decision(state, choice['playerId'], choice['id'],
                                       option if option is not None else choice['options'][-1]['id'],
                                       timed_out=auto)
    actor = state.pending_roll['nextPlayerId'] if state.pending_roll else state.active_player_id
    return engine.roll_dice(state, actor)


def main():
    coverage = Counter()
    checked = set()
    questions = 0
    invalid = 0
    races = 0
    for seed in range(8):
        for lineup in LINEUPS:
            engine = MagsimGameEngine(random.Random(seed))
            players = (Player('a', 'A'), Player('b', 'B'))
            state = replace(engine.create_game(players), phase=GamePhase.CHARACTER_SELECTION,
                            race_number=2 if seed % 2 else 0, first_turn_player_id='a',
                            teams={p.id: tuple(ATHLETE_BY_ID[x] for x in lineup[i*2:i*2+2])
                                   for i, p in enumerate(players)})
            for p in players:
                state = engine.select_racers(state, p.id, tuple(c.id for c in state.teams[p.id])).state
            for step in range(2000):
                if state.phase != GamePhase.RACING:
                    races += 1
                    break
                choice = state.pending_decision
                if choice:
                    questions += 1
                    key = (seed, choice['abilityName'])
                    if key not in checked:
                        checked.add(key)
                        snapshot = pickle.dumps((engine, state))
                        for option in [o['id'] for o in choice['options']] + ['AUTO']:
                            fork_engine, fork_state = pickle.loads(snapshot)
                            transition = advance(fork_engine, fork_state, option, option == 'AUTO')
                            assert transition.events[0]['decisionId'] == choice['id']
                            assert transition.state.pending_decision is None or transition.state.pending_decision['id'] != choice['id']
                            coverage[choice['abilityName']] += 1
                            # Resume across multiple later pauses, rather than merely accepting the request.
                            for _ in range(6):
                                if transition.state.phase != GamePhase.RACING:
                                    break
                                transition = advance(fork_engine, transition.state, auto=True)
                        for actor, decision_id, option, code in [
                            ('b' if choice['playerId'] == 'a' else 'a', choice['id'], '0', 'NOT_DECIDING_PLAYER'),
                            (choice['playerId'], 'stale-question', '0', 'STALE_DECISION'),
                            (choice['playerId'], choice['id'], '9999', 'INVALID_DECISION_OPTION'),
                            (choice['playerId'], choice['id'], '-1', 'INVALID_DECISION_OPTION'),
                        ]:
                            fork_engine, fork_state = pickle.loads(snapshot)
                            before = json.dumps(fork_engine.public_state(fork_state), sort_keys=True)
                            try:
                                fork_engine.resolve_decision(fork_state, actor, decision_id, option)
                            except GameRuleError as error:
                                assert error.code == code
                            else:
                                raise AssertionError((choice, code))
                            assert before == json.dumps(fork_engine.public_state(fork_state), sort_keys=True)
                            assert fork_state.magsim_engine.agents[0].broker.pending.answer_index is None
                            invalid += 1
                state = advance(engine, state, auto=seed % 2 == 1).state
            else:
                raise AssertionError(('action limit', seed, lineup))
    assert EXPECTED <= coverage.keys(), EXPECTED - coverage.keys()
    print(json.dumps({'races': races, 'questions': questions, 'branches': dict(coverage),
                      'total_branches': sum(coverage.values()), 'invalid_submissions': invalid}, indent=2))


if __name__ == '__main__':
    main()
