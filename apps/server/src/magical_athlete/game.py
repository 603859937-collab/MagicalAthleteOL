from __future__ import annotations

import random
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Any, Protocol

from .athletes import ATHLETE_CATALOG, AthleteCard


class GameRuleError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class GamePhase(StrEnum):
    LOBBY = "LOBBY"
    CHARACTER_SELECTION = "CHARACTER_SELECTION"
    RACING = "RACING"
    FINISHED = "FINISHED"


@dataclass(frozen=True, slots=True)
class Player:
    id: str
    name: str


@dataclass(frozen=True, slots=True)
class GameState:
    phase: GamePhase
    players: tuple[Player, ...]
    positions: dict[str, int]
    hands: dict[str, tuple[AthleteCard, ...]]
    selections: dict[str, AthleteCard]
    active_player_id: str | None = None
    winner_id: str | None = None
    player_racer_indices: dict[str, int] = field(default_factory=dict)
    magsim_engine: Any | None = None


@dataclass(frozen=True, slots=True)
class GameTransition:
    state: GameState
    events: tuple[dict[str, Any], ...]


class GameEngine(Protocol):
    """Stable port implemented by the demo rules now and a magsim adapter later."""

    def create_game(self, players: tuple[Player, ...]) -> GameState: ...

    def start(self, state: GameState, player_id: str) -> GameTransition: ...

    def select_athlete(
        self, state: GameState, player_id: str, athlete_id: str
    ) -> GameTransition: ...

    def roll_dice(self, state: GameState, player_id: str) -> GameTransition: ...

    def public_state(self, state: GameState, viewer_id: str | None = None) -> dict[str, Any]: ...


class DemoGameEngine:
    finish_line = 20

    def __init__(self, rng: random.Random | None = None) -> None:
        self._rng = rng or random.SystemRandom()

    def create_game(self, players: tuple[Player, ...]) -> GameState:
        return GameState(
            phase=GamePhase.LOBBY,
            players=players,
            positions={player.id: 0 for player in players},
            hands={},
            selections={},
        )

    def start(self, state: GameState, player_id: str) -> GameTransition:
        if state.phase != GamePhase.LOBBY:
            raise GameRuleError("GAME_ALREADY_STARTED", "比赛已经开始")
        if len(state.players) < 2:
            raise GameRuleError("NOT_ENOUGH_PLAYERS", "至少需要两名玩家")
        if state.players[0].id != player_id:
            raise GameRuleError("ONLY_HOST_CAN_START", "只有房主可以开始比赛")
        dealt = self._rng.sample(ATHLETE_CATALOG, len(state.players) * 4)
        hands = {
            player.id: tuple(dealt[index * 4 : index * 4 + 4])
            for index, player in enumerate(state.players)
        }
        next_state = replace(
            state,
            phase=GamePhase.CHARACTER_SELECTION,
            hands=hands,
            selections={},
        )
        return GameTransition(next_state, ({"type": "ATHLETES_DEALT"},))

    def select_athlete(
        self, state: GameState, player_id: str, athlete_id: str
    ) -> GameTransition:
        if state.phase != GamePhase.CHARACTER_SELECTION:
            raise GameRuleError("NOT_SELECTING_ATHLETES", "当前不在角色选择阶段")
        if player_id in state.selections:
            raise GameRuleError("ATHLETE_ALREADY_LOCKED", "角色已经锁定，不能修改")
        athlete = next(
            (card for card in state.hands.get(player_id, ()) if card.id == athlete_id),
            None,
        )
        if athlete is None:
            raise GameRuleError("ATHLETE_NOT_IN_HAND", "该角色不在你的手牌中")

        selections = {**state.selections, player_id: athlete}
        events: list[dict[str, Any]] = [
            {"type": "ATHLETE_SELECTION_LOCKED", "playerId": player_id}
        ]
        if len(selections) == len(state.players):
            next_state = replace(
                state,
                phase=GamePhase.RACING,
                selections=selections,
                active_player_id=state.players[0].id,
            )
            events.extend(({"type": "ATHLETES_REVEALED"}, {"type": "GAME_STARTED"}))
        else:
            next_state = replace(state, selections=selections)
        return GameTransition(next_state, tuple(events))

    def roll_dice(self, state: GameState, player_id: str) -> GameTransition:
        if state.phase != GamePhase.RACING:
            raise GameRuleError("GAME_NOT_RUNNING", "比赛尚未开始")
        if state.active_player_id != player_id:
            raise GameRuleError("NOT_YOUR_TURN", "还没轮到你")

        value = self._rng.randint(1, 6)
        old_position = state.positions[player_id]
        new_position = min(self.finish_line, old_position + value)
        positions = {**state.positions, player_id: new_position}
        events: list[dict[str, Any]] = [
            {"type": "DICE_ROLLED", "playerId": player_id, "value": value},
            {
                "type": "ATHLETE_MOVED",
                "athleteId": player_id,
                "from": old_position,
                "to": new_position,
            },
        ]

        if new_position >= self.finish_line:
            next_state = replace(
                state,
                phase=GamePhase.FINISHED,
                positions=positions,
                active_player_id=None,
                winner_id=player_id,
            )
            events.append({"type": "RACE_FINISHED", "winnerId": player_id})
        else:
            player_ids = [player.id for player in state.players]
            next_index = (player_ids.index(player_id) + 1) % len(player_ids)
            next_player_id = player_ids[next_index]
            next_state = replace(state, positions=positions, active_player_id=next_player_id)
            events.append({"type": "TURN_CHANGED", "playerId": next_player_id})

        return GameTransition(next_state, tuple(events))

    def public_state(self, state: GameState, viewer_id: str | None = None) -> dict[str, Any]:
        selections_revealed = state.phase in (GamePhase.RACING, GamePhase.FINISHED)
        return {
            "phase": state.phase,
            "finishLine": self.finish_line,
            "players": [
                {
                    "id": player.id,
                    "name": player.name,
                    "position": state.positions[player.id],
                    "selectionLocked": player.id in state.selections,
                    "selectedAthlete": (
                        state.selections[player.id].public_data()
                        if selections_revealed and player.id in state.selections
                        else None
                    ),
                }
                for player in state.players
            ],
            "hand": [card.public_data() for card in state.hands.get(viewer_id or "", ())],
            "activePlayerId": state.active_player_id,
            "winnerId": state.winner_id,
        }


MAGSIM_RACER_BY_ATHLETE_ID = {
    "alchemist": "Alchemist",
    "banana": "Banana",
    "blimp": "Blimp",
    "centaur": "Centaur",
    "cheerleader": "Cheerleader",
    "coach": "Coach",
    "egg": "Egg",
    "hare": "Hare",
    "huge_baby": "HugeBaby",
    "inchworm": "Inchworm",
    "legs": "Legs",
    "magician": "Magician",
    "party_animal": "PartyAnimal",
    "rocket_scientist": "RocketScientist",
    "sisyphus": "Sisyphus",
    "skipper": "Skipper",
}


class MagsimGameEngine(DemoGameEngine):
    """Adapter from the multiplayer room protocol to the vendored magsim rules."""

    finish_line = 30

    def __init__(
        self,
        rng: random.Random | None = None,
        *,
        board_name: str = "Standard",
    ) -> None:
        super().__init__(rng)
        self.board_name = board_name

    def select_athlete(
        self, state: GameState, player_id: str, athlete_id: str
    ) -> GameTransition:
        transition = super().select_athlete(state, player_id, athlete_id)
        if transition.state.phase != GamePhase.RACING:
            return transition

        magsim_engine, player_racer_indices = self._create_magsim_engine(
            transition.state
        )
        positions = self._positions_from_magsim(
            transition.state.players, player_racer_indices, magsim_engine
        )
        active_player_id = self._active_player_id(
            transition.state.players, player_racer_indices, magsim_engine
        )
        next_state = replace(
            transition.state,
            positions=positions,
            active_player_id=active_player_id,
            winner_id=None,
            player_racer_indices=player_racer_indices,
            magsim_engine=magsim_engine,
        )
        return GameTransition(next_state, transition.events)

    def roll_dice(self, state: GameState, player_id: str) -> GameTransition:
        if state.phase != GamePhase.RACING:
            raise GameRuleError("GAME_NOT_RUNNING", "比赛尚未开始")
        if state.active_player_id != player_id:
            raise GameRuleError("NOT_YOUR_TURN", "还没轮到你")
        if state.magsim_engine is None:
            raise GameRuleError("MAGSIM_NOT_READY", "正式规则引擎尚未初始化")

        magsim_engine = state.magsim_engine
        player_by_racer = {
            racer_idx: pid for pid, racer_idx in state.player_racer_indices.items()
        }
        events: list[dict[str, Any]] = []

        def record_event(engine: Any, event: Any) -> None:
            del engine
            self._append_public_event(events, player_by_racer, event)

        previous_callback = magsim_engine.on_event_processed
        magsim_engine.on_event_processed = record_event
        try:
            magsim_engine.run_turn()
            magsim_engine.advance_turn()
        finally:
            magsim_engine.on_event_processed = previous_callback

        positions = self._positions_from_magsim(
            state.players, state.player_racer_indices, magsim_engine
        )
        winner_id = self._winner_id(
            state.players, state.player_racer_indices, magsim_engine
        )

        if magsim_engine.state.race_active:
            active_player_id = self._active_player_id(
                state.players, state.player_racer_indices, magsim_engine
            )
            phase = GamePhase.RACING
            events.append({"type": "TURN_CHANGED", "playerId": active_player_id})
        else:
            active_player_id = None
            phase = GamePhase.FINISHED
            events.append({"type": "RACE_FINISHED", "winnerId": winner_id})

        return GameTransition(
            replace(
                state,
                phase=phase,
                positions=positions,
                active_player_id=active_player_id,
                winner_id=winner_id if phase == GamePhase.FINISHED else None,
                magsim_engine=magsim_engine,
            ),
            tuple(events),
        )

    def public_state(self, state: GameState, viewer_id: str | None = None) -> dict[str, Any]:
        selections_revealed = state.phase in (GamePhase.RACING, GamePhase.FINISHED)
        finish_line = self._finish_line_for_state(state)
        return {
            "phase": state.phase,
            "finishLine": finish_line,
            "players": [
                self._public_player_state(
                    state,
                    player,
                    selections_revealed=selections_revealed,
                )
                for player in state.players
            ],
            "hand": [card.public_data() for card in state.hands.get(viewer_id or "", ())],
            "activePlayerId": state.active_player_id,
            "winnerId": state.winner_id,
        }

    def _create_magsim_engine(
        self, state: GameState
    ) -> tuple[Any, dict[str, int]]:
        from magsim.engine.scenario import GameScenario, RacerConfig

        racer_configs = []
        player_racer_indices: dict[str, int] = {}
        for idx, player in enumerate(state.players):
            selected = state.selections[player.id]
            racer_name = MAGSIM_RACER_BY_ATHLETE_ID.get(selected.id)
            if racer_name is None:
                raise GameRuleError(
                    "UNSUPPORTED_ATHLETE",
                    f"角色 {selected.name} 暂未接入正式规则",
                )
            racer_configs.append(RacerConfig(idx=idx, name=racer_name))
            player_racer_indices[player.id] = idx

        seed = self._rng.randrange(0, 2**63)
        scenario = GameScenario(
            racers_config=racer_configs,
            board=None,
            rules=None,
            seed=seed,
        )
        if self.board_name != "Standard":
            from magsim.engine.board import BOARD_DEFINITIONS

            scenario.state.board = BOARD_DEFINITIONS[self.board_name]()
        scenario.engine.verbose = False
        return scenario.engine, player_racer_indices

    def _append_public_event(
        self,
        events: list[dict[str, Any]],
        player_by_racer: dict[int, str],
        event: Any,
    ) -> None:
        event_name = event.__class__.__name__

        if event_name == "RollResultEvent":
            player_id = player_by_racer.get(event.target_racer_idx)
            value = event.dice_value if event.dice_value is not None else event.base_value
            events.append(
                {
                    "type": "DICE_ROLLED",
                    "playerId": player_id,
                    "value": value,
                    "baseValue": event.base_value,
                    "finalValue": event.final_value,
                }
            )
            return

        if event_name in {"PostMoveEvent", "PostWarpEvent"}:
            player_id = player_by_racer.get(event.target_racer_idx)
            events.append(
                {
                    "type": "ATHLETE_MOVED",
                    "playerId": player_id,
                    "athleteId": player_id,
                    "from": event.start_tile,
                    "to": event.end_tile,
                }
            )
            return

        if event_name == "RacerFinishedEvent":
            player_id = player_by_racer.get(event.target_racer_idx)
            events.append(
                {
                    "type": "RACER_FINISHED",
                    "playerId": player_id,
                    "finishPosition": event.finishing_position,
                }
            )
            return

        if event_name == "RacerEliminatedEvent":
            player_id = player_by_racer.get(event.target_racer_idx)
            events.append({"type": "RACER_ELIMINATED", "playerId": player_id})
            return

        if event_name == "TripRecoveryEvent":
            player_id = player_by_racer.get(event.target_racer_idx)
            events.append({"type": "TRIP_RECOVERED", "playerId": player_id})

    def _public_player_state(
        self,
        state: GameState,
        player: Player,
        *,
        selections_revealed: bool,
    ) -> dict[str, Any]:
        racer = self._magsim_racer_for_player(state, player.id)
        position = state.positions.get(player.id, 0)
        if racer is not None and racer.position is not None:
            position = racer.position

        data: dict[str, Any] = {
            "id": player.id,
            "name": player.name,
            "position": position,
            "selectionLocked": player.id in state.selections,
            "selectedAthlete": (
                state.selections[player.id].public_data()
                if selections_revealed and player.id in state.selections
                else None
            ),
        }
        if racer is not None:
            data.update(
                {
                    "victoryPoints": racer.victory_points,
                    "finished": racer.finished,
                    "finishPosition": racer.finish_position,
                    "eliminated": racer.eliminated,
                    "tripped": racer.tripped,
                }
            )
        return data

    def _magsim_racer_for_player(self, state: GameState, player_id: str) -> Any | None:
        if state.magsim_engine is None:
            return None
        racer_idx = state.player_racer_indices.get(player_id)
        if racer_idx is None:
            return None
        return state.magsim_engine.get_racer(racer_idx)

    def _finish_line_for_state(self, state: GameState) -> int:
        if state.magsim_engine is None:
            return self.finish_line
        return state.magsim_engine.state.board.length

    def _positions_from_magsim(
        self,
        players: tuple[Player, ...],
        player_racer_indices: dict[str, int],
        magsim_engine: Any,
    ) -> dict[str, int]:
        positions: dict[str, int] = {}
        for player in players:
            racer_idx = player_racer_indices[player.id]
            position = magsim_engine.get_racer(racer_idx).position
            positions[player.id] = position if position is not None else 0
        return positions

    def _active_player_id(
        self,
        players: tuple[Player, ...],
        player_racer_indices: dict[str, int],
        magsim_engine: Any,
    ) -> str | None:
        if not magsim_engine.state.race_active:
            return None
        current_racer_idx = magsim_engine.state.current_racer_idx
        for player in players:
            if player_racer_indices[player.id] == current_racer_idx:
                return player.id
        return None

    def _winner_id(
        self,
        players: tuple[Player, ...],
        player_racer_indices: dict[str, int],
        magsim_engine: Any,
    ) -> str | None:
        for player in players:
            racer = magsim_engine.get_racer(player_racer_indices[player.id])
            if racer.finish_position == 1:
                return player.id
        return None
