from fastapi.testclient import TestClient

from magical_athlete.main import app


def test_create_room_and_join() -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    with client.websocket_connect("/ws") as socket:
        socket.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Alice"})
        welcome = socket.receive_json()

    assert welcome["type"] == "WELCOME"
    assert welcome["roomId"] == room_id
    assert welcome["game"]["players"][0]["name"] == "Alice"
    assert welcome["game"]["phase"] == "LOBBY"


def test_players_start_with_public_roll_off() -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    with client.websocket_connect("/ws") as alice, client.websocket_connect("/ws") as bob:
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
