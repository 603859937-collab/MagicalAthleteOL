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
    assert welcome["reconnectToken"]


def test_two_players_can_start_and_roll() -> None:
    client = TestClient(app)
    room_id = client.post("/api/rooms").json()["roomId"]

    with client.websocket_connect("/ws") as alice, client.websocket_connect("/ws") as bob:
        alice.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Alice"})
        alice_welcome = alice.receive_json()
        alice_id = alice_welcome["playerId"]

        bob.send_json({"type": "JOIN_ROOM", "roomId": room_id, "playerName": "Bob"})
        bob.receive_json()
        alice.receive_json()

        alice.send_json({"type": "START_GAME", "actionId": "start-1"})
        dealt_for_alice = alice.receive_json()
        dealt_for_bob = bob.receive_json()

        assert dealt_for_alice["game"]["phase"] == "CHARACTER_SELECTION"
        assert len(dealt_for_alice["game"]["hand"]) == 4
        assert len(dealt_for_bob["game"]["hand"]) == 4
        alice_cards = {card["id"] for card in dealt_for_alice["game"]["hand"]}
        bob_cards = {card["id"] for card in dealt_for_bob["game"]["hand"]}
        assert alice_cards.isdisjoint(bob_cards)

        alice.send_json(
            {
                "type": "SELECT_ATHLETE",
                "actionId": "select-a",
                "athleteId": next(iter(alice_cards)),
            }
        )
        alice_locked = alice.receive_json()
        bob_sees_alice_locked = bob.receive_json()
        assert alice_locked["game"]["phase"] == "CHARACTER_SELECTION"
        assert bob_sees_alice_locked["game"]["players"][0]["selectionLocked"] is True
        assert bob_sees_alice_locked["game"]["players"][0]["selectedAthlete"] is None

        bob.send_json(
            {
                "type": "SELECT_ATHLETE",
                "actionId": "select-b",
                "athleteId": next(iter(bob_cards)),
            }
        )
        started_for_alice = alice.receive_json()
        started_for_bob = bob.receive_json()
        assert started_for_alice["game"]["activePlayerId"] == alice_id
        assert started_for_bob["revision"] == started_for_alice["revision"]
        assert all(
            player["selectedAthlete"] is not None
            for player in started_for_alice["game"]["players"]
        )

        alice.send_json({"type": "ROLL_DICE", "actionId": "roll-1"})
        rolled = alice.receive_json()
        bob.receive_json()

        assert rolled["events"][0]["type"] == "DICE_ROLLED"
        assert rolled["game"]["players"][0]["position"] >= 1
