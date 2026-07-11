from typing import Annotated, Literal

from pydantic import BaseModel, Field


class JoinRoomIntent(BaseModel):
    type: Literal["JOIN_ROOM"]
    room_id: str = Field(alias="roomId", min_length=4, max_length=8)
    player_name: str = Field(alias="playerName", min_length=1, max_length=24)
    player_id: str | None = Field(default=None, alias="playerId")
    reconnect_token: str | None = Field(default=None, alias="reconnectToken")


class StartGameIntent(BaseModel):
    type: Literal["START_GAME"]
    action_id: str = Field(alias="actionId", min_length=1, max_length=64)


class RollDiceIntent(BaseModel):
    type: Literal["ROLL_DICE"]
    action_id: str = Field(alias="actionId", min_length=1, max_length=64)


class SelectAthleteIntent(BaseModel):
    type: Literal["SELECT_ATHLETE"]
    action_id: str = Field(alias="actionId", min_length=1, max_length=64)
    athlete_id: str = Field(alias="athleteId", min_length=1, max_length=64)


ClientIntent = Annotated[
    JoinRoomIntent | StartGameIntent | SelectAthleteIntent | RollDiceIntent,
    Field(discriminator="type"),
]


class ErrorMessage(BaseModel):
    type: Literal["ERROR"] = "ERROR"
    code: str
    message: str
    action_id: str | None = Field(default=None, alias="actionId")

    model_config = {"populate_by_name": True}
