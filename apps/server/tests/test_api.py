from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

from magical_athlete.main import app


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_create_room_and_join(origin: str) -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    with client.websocket_connect("/ws", headers={"origin": origin}) as socket:
        socket.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Alice"})
        welcome = socket.receive_json()

    assert welcome["type"] == "WELCOME"
    assert welcome["roomId"] == room_id
    assert welcome["game"]["players"][0]["name"] == "Alice"
    assert welcome["game"]["phase"] == "LOBBY"


def test_rejects_untrusted_websocket_origin() -> None:
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/ws", headers={"origin": "https://untrusted.example"}):
            pass
    assert error.value.code == 1008


def test_players_start_with_public_roll_off() -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    headers = {"origin": "http://localhost:5173"}
    with client.websocket_connect("/ws", headers=headers) as alice, client.websocket_connect("/ws", headers=headers) as bob:
        alice.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Alice"})
        alice_welcome = alice.receive_json()
        bob.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Bob"})
        bob_welcome = bob.receive_json()
        alice.receive_json()

        alice.send_json({"type": "START_GAME", "actionId": "start-1"})
        started_alice = alice.receive_json()
        bob.receive_json()
        assert started_alice["game"]["phase"] == "DRAFT_ROLL"
        assert started_alice["game"]["draftPool"] == []

        alice.send_json({"type": "ROLL_START", "actionId": "roll-a"})
        rolled_alice = alice.receive_json()
        bob.receive_json()
        alice_state = next(player for player in rolled_alice["game"]["players"] if player["id"] == alice_welcome["playerId"])
        assert len(alice_state["rollValues"]) == 2

        bob.send_json({"type": "ROLL_START", "actionId": "roll-b"})
        resolved_bob = bob.receive_json()
        alice.receive_json()
        assert resolved_bob["game"]["phase"] in ("DRAFTING", "DRAFT_ROLL")
        if resolved_bob["game"]["phase"] == "DRAFTING":
            assert len(resolved_bob["game"]["draftPool"]) == 8
            assert resolved_bob["game"]["activePlayerId"] in {
                alice_welcome["playerId"], bob_welcome["playerId"]
            }


def test_host_can_auto_deal_and_skip_the_snake_draft() -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    headers = {"origin": "http://localhost:5173"}
    with client.websocket_connect("/ws", headers=headers) as alice, client.websocket_connect("/ws", headers=headers) as bob:
        alice.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Alice"})
        alice.receive_json()
        bob.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Bob"})
        bob.receive_json()
        alice.receive_json()

        alice.send_json({"type": "SET_AUTO_DEAL", "actionId": "auto-1", "autoDeal": True})
        toggled = alice.receive_json()
        bob.receive_json()
        assert toggled["game"]["autoDeal"] is True
        assert toggled["game"]["cardsPerPlayer"] == 8

        alice.send_json({"type": "START_GAME", "actionId": "start-1"})
        started = alice.receive_json()
        bob.receive_json()
        assert started["game"]["phase"] == "RACE_ROLL"
        assert started["game"]["draftPool"] == []
        assert [event["type"] for event in started["events"]].count("TEAM_DEALT") == 2
        assert all(len(player["team"]) == 8 for player in started["game"]["players"])
        assert len(started["game"]["hand"]) == 8


def test_host_can_add_a_bot_from_the_lobby() -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    headers = {"origin": "http://localhost:5173"}
    with client.websocket_connect("/ws", headers=headers) as alice:
        alice.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Alice"})
        alice.receive_json()

        alice.send_json({"type": "ADD_BOT", "actionId": "bot-1"})
        update = alice.receive_json()

        bot = update["game"]["players"][-1]
        assert bot["isBot"] is True
        assert update["events"] == [
            {"type": "PLAYER_JOINED", "playerId": bot["id"], "bot": True}
        ]

        alice.send_json({"type": "START_GAME", "actionId": "start-1"})
        started = alice.receive_json()
        assert started["game"]["phase"] == "DRAFT_ROLL"
