"""Offline, seeded race probes; run with PYTHONPATH=apps/server/src."""
import argparse
import json
import random
import signal
import traceback
from collections import Counter
from dataclasses import replace

from magical_athlete.athletes import ATHLETE_BY_ID
from magical_athlete.game import GamePhase, MagsimGameEngine, Player

COMBINATIONS = [
    ('copycat', 'duelist', 'suckerfish', 'hypnotist'),
    ('dicemonger', 'magician', 'legs', 'genius'),
    ('mouth', 'huge_baby', 'leaptoad', 'suckerfish'),
    ('banana', 'baba_yaga', 'centaur', 'romantic'),
    ('egg', 'copycat', 'third_wheel', 'flip_flop'),
    ('cheerleader', 'heckler', 'inchworm', 'lovable_loser'),
]


def run_race(seed, lineup, policy, race_number, trace=None):
    rng = random.Random(seed + 10000)
    engine = MagsimGameEngine(random.Random(seed))
    players = (Player('a', 'A'), Player('b', 'B'))
    state = replace(engine.create_game(players), phase=GamePhase.CHARACTER_SELECTION,
                    first_turn_player_id='a', race_number=race_number,
                    teams={p.id: tuple(ATHLETE_BY_ID[x] for x in lineup[i*2:i*2+2])
                           for i, p in enumerate(players)})
    events, choices = Counter(), Counter()
    trail = []
    visible_positions = {athlete: 0 for athlete in lineup}
    def observe(transition):
        if trace is not None:
            trace.append({"events": transition.events, "positions": dict(transition.state.positions)})
        for event in transition.events:
            if event['type'] in ('RACER_MOVED', 'RACER_WARPED'):
                athlete = event['athleteId']
                assert visible_positions[athlete] == event['from'], ('discontinuous movement', event, visible_positions)
                visible_positions[athlete] = event['to']
        for racer in transition.state.magsim_engine.state.racers if transition.state.magsim_engine else ():
            athlete = transition.state.racer_athlete_by_index[racer.idx].id
            if racer.position is not None:
                assert visible_positions[athlete] == racer.position, ('unpublished movement', athlete, visible_positions[athlete], racer.position)
    for p in players:
        transition = engine.select_racers(state, p.id, tuple(c.id for c in state.teams[p.id]))
        observe(transition)
        state = transition.state
        events.update(e['type'] for e in transition.events)
    for step in range(2000):
        assert not (state.pending_decision and state.pending_roll)
        racers = state.magsim_engine.state.racers
        places = [r.finish_position for r in racers if r.finished]
        assert len(places) == len(set(places)), ('duplicate finish', places)
        assert all(r.position is None or r.position >= 0 for r in racers)
        assert all(not (r.finished and r.eliminated) for r in racers)
        json.dumps(engine.public_state(state))
        if state.phase != GamePhase.RACING:
            assert state.phase in (GamePhase.RACE_RESULTS, GamePhase.FINISHED)
            return {'steps': step, 'events': dict(events), 'choices': dict(choices)}
        decision = state.pending_decision
        if decision:
            choices[decision['abilityName']] += 1
            options = decision['options']
            if policy == 'decline':
                option = next((o for o in options if o['label'] == '不使用'), options[0])
            elif policy == 'accept':
                option = [o for o in options if o['id'] != 'skip'][-1]
            else:
                option = rng.choice(options)
            trail.append((decision['abilityName'], option['id']))
            transition = engine.resolve_decision(state, decision['playerId'], decision['id'],
                                                 option['id'], timed_out=policy == 'auto')
        else:
            actor = state.pending_roll['nextPlayerId'] if state.pending_roll else state.active_player_id
            trail.append(('roll', actor))
            transition = engine.roll_dice(state, actor)
        observe(transition)
        state = transition.state
        events.update(e['type'] for e in transition.events)
    raise AssertionError(('race exceeded 2000 actions', trail[-20:]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seeds', type=int, default=10)
    parser.add_argument('--output', default='/tmp/skill-probe.json')
    args = parser.parse_args()
    results, failures = [], []
    def timeout(*_):
        raise TimeoutError('single race exceeded 10 seconds')
    signal.signal(signal.SIGALRM, timeout)
    for seed in range(args.seeds):
        lineups = COMBINATIONS + [tuple(random.Random(seed).sample(sorted(ATHLETE_BY_ID), 4))]
        for lineup in lineups:
            for policy in ('accept', 'decline', 'random', 'auto'):
                for race_number in (0, 2):
                    case = dict(seed=seed, lineup=lineup, policy=policy, race_number=race_number)
                    try:
                        signal.alarm(10)
                        result = run_race(**case)
                        results.append({**case, **result})
                    except Exception:
                        failures.append({**case, 'error': traceback.format_exc()})
                    finally:
                        signal.alarm(0)
        print(f'seed {seed}: {len(results)} passed, {len(failures)} failed', flush=True)
    with open(args.output, 'w') as stream:
        json.dump({'results': results, 'failures': failures}, stream, indent=2)
    print('Report:', args.output)


if __name__ == '__main__':
    main()
