import random
from dataclasses import replace

import pytest

from magical_athlete.athletes import ATHLETE_BY_ID, ATHLETE_CATALOG
from magical_athlete.game import GamePhase, GameRuleError, MagsimGameEngine, Player


def make_players(count: int) -> tuple[Player, ...]:
    return tuple(Player(f"p{index}", f"Player {index}") for index in range(count))


def complete_roll_off(engine: MagsimGameEngine, state):
    while state.phase in (GamePhase.DRAFT_ROLL, GamePhase.RACE_ROLL):
        for player_id in state.roll_candidates:
            if player_id not in state.roll_values:
                state = engine.roll_start(state, player_id).state
    return state


def complete_draft(engine: MagsimGameEngine, state):
    while state.phase == GamePhase.DRAFTING:
        state = engine.draft_athlete(
            state, state.active_player_id, state.draft_pool[0].id
        ).state
    return state


def test_complete_catalog_matches_vendored_rules() -> None:
    from magsim.core.registry import RACER_ABILITIES

    assert len(ATHLETE_CATALOG) == 36
    assert {card.engine_name for card in ATHLETE_CATALOG} == set(RACER_ABILITIES)


@pytest.mark.parametrize(
    ("player_count", "expected_team_size", "expected_picks"),
    ((2, 8, 16), (3, 4, 12), (4, 4, 16), (5, 4, 20), (6, 4, 24)),
)
def test_formal_draft_sizes(player_count: int, expected_team_size: int, expected_picks: int) -> None:
    engine = MagsimGameEngine(random.Random(5))
    players = make_players(player_count)
    state = engine.start(engine.create_game(players), players[0].id).state
    state = complete_roll_off(engine, state)
    picks = 0
    seen: set[str] = set()
    while state.phase == GamePhase.DRAFTING:
        picked = state.draft_pool[0]
        assert picked.id not in seen
        seen.add(picked.id)
        state = engine.draft_athlete(state, state.active_player_id, picked.id).state
        picks += 1

    assert state.phase == GamePhase.RACE_ROLL
    assert picks == expected_picks
    assert all(len(state.teams[player.id]) == expected_team_size for player in players)


def test_two_player_first_draft_uses_abbaabba_order() -> None:
    engine = MagsimGameEngine(random.Random(2))
    players = make_players(2)
    state = complete_roll_off(engine, engine.start(engine.create_game(players), "p0").state)
    a, b = state.draft_order[0], state.draft_order[1]
    assert state.draft_order == (a, b, b, a, a, b, b, a)


def test_three_player_double_racer_variant_drafts_eight_each() -> None:
    engine = MagsimGameEngine(random.Random(11))
    players = make_players(3)
    state = engine.set_variant(engine.create_game(players), "p0", True).state
    state = complete_draft(engine, complete_roll_off(engine, engine.start(state, "p0").state))

    assert all(len(state.teams[player.id]) == 8 for player in players)
    assert engine.public_state(state)["doubleRacerVariant"] is True


def test_selection_is_secret_and_requires_two_unique_racers_for_two_players() -> None:
    engine = MagsimGameEngine(random.Random(7))
    players = make_players(2)
    teams = {
        "p0": (ATHLETE_BY_ID["banana"], ATHLETE_BY_ID["skipper"]),
        "p1": (ATHLETE_BY_ID["coach"], ATHLETE_BY_ID["alchemist"]),
    }
    state = replace(
        engine.create_game(players),
        phase=GamePhase.CHARACTER_SELECTION,
        teams=teams,
        first_turn_player_id="p0",
    )

    with pytest.raises(GameRuleError) as error:
        engine.select_racers(state, "p0", ("banana",))
    assert error.value.code == "INVALID_RACER_COUNT"

    state = engine.select_racers(state, "p0", ("banana", "skipper")).state
    assert engine.public_state(state, "p1")["players"][0]["activeRacers"] == []
    assert engine.public_state(state, "p1")["players"][0]["selectionLocked"] is True

    state = engine.select_racers(state, "p1", ("coach", "alchemist")).state
    assert state.phase == GamePhase.RACING
    assert len(state.magsim_engine.state.racers) == 4
    assert [state.racer_owner_by_index[index] for index in range(4)] == ["p0", "p0", "p1", "p1"]
    assert all(engine.public_state(state, "p1")["players"][index]["activeRacers"] for index in range(2))


def test_race_uses_schedule_rewards_and_accumulates_score() -> None:
    engine = MagsimGameEngine(random.Random(3))
    players = make_players(4)
    teams = {
        "p0": (ATHLETE_BY_ID["banana"],),
        "p1": (ATHLETE_BY_ID["skipper"],),
        "p2": (ATHLETE_BY_ID["coach"],),
        "p3": (ATHLETE_BY_ID["alchemist"],),
    }
    state = replace(
        engine.create_game(players),
        phase=GamePhase.CHARACTER_SELECTION,
        teams=teams,
        first_turn_player_id="p0",
        race_number=2,
    )
    for player in players:
        state = engine.select_racers(state, player.id, (teams[player.id][0].id,)).state

    assert state.magsim_engine.state.rules.winner_vp == (4, 2)
    assert engine.public_state(state)["trackName"] == "WildWilds"
    # Force two ordinary racers across the line, preserving the authoritative turn flow.
    while state.phase == GamePhase.RACING:
        current_index = state.magsim_engine.state.current_racer_idx
        state.magsim_engine.get_racer(current_index).position = 29
        state = engine.roll_dice(state, state.active_player_id).state

    assert state.phase == GamePhase.RACE_RESULTS
    assert sum(state.scores.values()) >= 6
    assert len(state.used_athlete_ids) == 4


def test_only_host_can_start_or_advance() -> None:
    engine = MagsimGameEngine()
    state = engine.create_game(make_players(2))
    with pytest.raises(GameRuleError) as error:
        engine.start(state, "p1")
    assert error.value.code == "ONLY_HOST_CAN_START"
