from __future__ import annotations

import random
from dataclasses import dataclass, replace
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
