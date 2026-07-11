import random

import pytest

from magical_athlete.game import DemoGameEngine, GamePhase, GameRuleError, Player


def players() -> tuple[Player, ...]:
    return (Player("p1", "Alice"), Player("p2", "Bob"))


def test_host_can_start_and_turn_advances() -> None:
    engine = DemoGameEngine(random.Random(1))
    state = engine.create_game(players())

    started = engine.start(state, "p1")
    assert started.state.phase == GamePhase.CHARACTER_SELECTION
    assert len(started.state.hands["p1"]) == 4

    alice_selected = engine.select_athlete(
        started.state, "p1", started.state.hands["p1"][0].id
    )
    assert alice_selected.state.phase == GamePhase.CHARACTER_SELECTION
    started_race = engine.select_athlete(
        alice_selected.state, "p2", alice_selected.state.hands["p2"][0].id
    )
    assert started_race.state.phase == GamePhase.RACING
    assert started_race.state.active_player_id == "p1"

    rolled = engine.roll_dice(started_race.state, "p1")
    assert 1 <= rolled.state.positions["p1"] <= 6
    assert rolled.events[0]["value"] == rolled.state.positions["p1"]
    assert rolled.state.active_player_id == "p2"
    assert [event["type"] for event in rolled.events] == [
        "DICE_ROLLED",
        "ATHLETE_MOVED",
        "TURN_CHANGED",
    ]


def test_non_active_player_cannot_roll() -> None:
    engine = DemoGameEngine(random.Random(1))
    state = engine.start(engine.create_game(players()), "p1").state
    state = engine.select_athlete(state, "p1", state.hands["p1"][0].id).state
    state = engine.select_athlete(state, "p2", state.hands["p2"][0].id).state

    with pytest.raises(GameRuleError, match="还没轮到你"):
        engine.roll_dice(state, "p2")


def test_only_host_can_start() -> None:
    engine = DemoGameEngine()

    with pytest.raises(GameRuleError) as error:
        engine.start(engine.create_game(players()), "p2")

    assert error.value.code == "ONLY_HOST_CAN_START"


def test_dealt_athletes_are_unique_and_private() -> None:
    engine = DemoGameEngine(random.Random(1))
    state = engine.start(engine.create_game(players()), "p1").state

    dealt_ids = [card.id for hand in state.hands.values() for card in hand]
    assert len(dealt_ids) == 8
    assert len(set(dealt_ids)) == 8
    assert len(engine.public_state(state, "p1")["hand"]) == 4
    assert {card["id"] for card in engine.public_state(state, "p1")["hand"]}.isdisjoint(
        {card["id"] for card in engine.public_state(state, "p2")["hand"]}
    )


def test_selection_stays_secret_until_everyone_locks() -> None:
    engine = DemoGameEngine(random.Random(1))
    state = engine.start(engine.create_game(players()), "p1").state
    p1_card = state.hands["p1"][0]
    state = engine.select_athlete(state, "p1", p1_card.id).state

    p2_view = engine.public_state(state, "p2")
    assert p2_view["players"][0]["selectionLocked"] is True
    assert p2_view["players"][0]["selectedAthlete"] is None

    with pytest.raises(GameRuleError) as error:
        engine.select_athlete(state, "p1", state.hands["p1"][1].id)
    assert error.value.code == "ATHLETE_ALREADY_LOCKED"

    state = engine.select_athlete(state, "p2", state.hands["p2"][0].id).state
    assert engine.public_state(state, "p2")["players"][0]["selectedAthlete"]["id"] == p1_card.id
