from magsim.core.interactive import DecisionBroker, InteractiveAgent
from magsim.engine.scenario import GameScenario, RacerConfig


def test_copycat_auto_copies_sole_leader_without_interactive_choice() -> None:
    broker = DecisionBroker()
    agent = InteractiveAgent(broker)
    scenario = GameScenario(
        [
            RacerConfig(0, "Copycat", start_pos=0, agent=agent),
            RacerConfig(1, "Banana", start_pos=5),
            RacerConfig(2, "Coach", start_pos=3),
        ],
        dice_rolls=[1],
    )

    scenario.engine.start_turn()

    assert scenario.engine.continue_turn() is True
    assert broker.pending is None
    assert "BananaTrip" in scenario.engine.get_racer(0).abilities


def test_copycat_still_prompts_for_tied_leaders() -> None:
    broker = DecisionBroker()
    agent = InteractiveAgent(broker)
    scenario = GameScenario(
        [
            RacerConfig(0, "Copycat", start_pos=0, agent=agent),
            RacerConfig(1, "Banana", start_pos=5),
            RacerConfig(2, "Coach", start_pos=5),
        ],
        dice_rolls=[1],
    )

    scenario.engine.start_turn()

    assert scenario.engine.continue_turn() is False
    assert broker.pending is not None
    assert broker.pending.ability_name == "CopyLead"
