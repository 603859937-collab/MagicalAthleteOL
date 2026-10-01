import random
from dataclasses import replace
from datetime import timedelta

import pytest

from magical_athlete.athletes import ATHLETE_BY_ID
from magical_athlete.game import GamePhase, MagsimGameEngine, Player
from magical_athlete.protocol import JoinRoomIntent, ResolveDecisionIntent, SetAutoPlayIntent, StartGameIntent
from magical_athlete.rooms import InMemoryRoomRepository, RoomManager, RoomPlayer
from test_rooms import RecordingSocket


@pytest.fixture
def anyio_backend():
    return 'asyncio'


async def human_room(seed=17):
    repository = InMemoryRoomRepository()
    room = await repository.create(4, MagsimGameEngine(random.Random(seed)))
    players = (Player('a', 'Alice'), Player('b', 'Bob'))
    room.players = {p.id: RoomPlayer(p, f'token-{p.id}', socket=RecordingSocket()) for p in players}
    room.game_state = room.engine.create_game(players)
    return room, RoomManager(repository, local_timers=False, rng=random.Random(4))


async def toggle(manager, room, player_id, enabled, action='toggle'):
    await manager.handle_intent(room, player_id, SetAutoPlayIntent(type='SET_AUTO_PLAY', actionId=action, enabled=enabled))


@pytest.mark.anyio
async def test_two_managed_humans_finish_all_four_races_without_manual_game_actions(monkeypatch):
    from magical_athlete import rooms as room_module
    monkeypatch.setattr(room_module, 'ROLL_ANIMATION_LEAD_SECONDS', 0)
    room, manager = await human_room()
    for player_id in room.players:
        await toggle(manager, room, player_id, True)
    await manager.handle_intent(room, 'a', StartGameIntent(type='START_GAME', actionId='start'))
    for _ in range(4000):
        if room.game_state.phase == GamePhase.FINISHED:
            break
        assert room.bot_deadline is not None, f'Stalled in {room.game_state.phase}'
        assert await manager.resolve_bot_action(room, room.bot_deadline + timedelta(seconds=1))
    assert room.game_state.phase == GamePhase.FINISHED
    public = room.public_state('a')['game']['players']
    assert all(p['autoPlay'] and not p['isBot'] for p in public)
    assert [p['name'] for p in public] == ['Alice', 'Bob']
    events = [event for message in room.players['a'].socket.messages for event in message.get('events', [])]
    assert any(e['type'] == 'DICE_ROLLED' for e in events)
    assert any(e['type'] == 'DECISION_RESOLVED' and e.get('bot') and e.get('optionLabel') for e in events)
    assert len([e for e in events if e['type'] == 'RACE_FINISHED']) == 4


@pytest.mark.anyio
async def test_cancel_managed_play_cancels_the_queued_action_and_toggle_is_idempotent():
    room, manager = await human_room()
    await manager.handle_intent(room, 'a', StartGameIntent(type='START_GAME', actionId='start'))
    await toggle(manager, room, 'a', True, 'enable')
    deadline = room.bot_deadline
    assert deadline is not None
    revision = room.revision
    await toggle(manager, room, 'a', True, 'enable')
    assert room.revision == revision
    await toggle(manager, room, 'a', False, 'disable')
    state = room.game_state
    assert room.bot_deadline is None
    assert not await manager.resolve_bot_action(room, deadline + timedelta(seconds=1))
    assert room.game_state is state and not room.players['a'].auto_play


@pytest.mark.anyio
async def test_managed_identity_survives_disconnect_and_reconnect():
    room, manager = await human_room()
    await toggle(manager, room, 'a', True)
    original = room.players['a'].socket
    await manager.disconnect(room, 'a', original)
    new_socket = RecordingSocket()
    await manager.join(new_socket, JoinRoomIntent(type='JOIN_ROOM', roomId=room.id, playerName='Alice', playerId='a', reconnectToken='token-a'))
    assert room.players['a'].auto_play and not room.players['a'].is_bot
    assert new_socket.messages[0]['game']['players'][0]['autoPlay'] is True


@pytest.mark.anyio
async def test_spectator_cannot_enable_managed_play():
    room, manager = await human_room()
    socket = RecordingSocket()
    _, member_id = await manager.join(socket, JoinRoomIntent(type='JOIN_ROOM', roomId=room.id, playerName='Watcher', role='spectator'))
    await toggle(manager, room, member_id, True)
    assert socket.messages[-1]['code'] == 'SPECTATOR_READ_ONLY'
    assert not any(member.auto_play for member in room.players.values())


@pytest.mark.anyio
async def test_managed_player_cannot_manually_resolve_another_players_skill():
    room, manager = await human_room()
    state = replace(room.game_state, phase=GamePhase.CHARACTER_SELECTION, first_turn_player_id='b',
                    teams={'a': (ATHLETE_BY_ID['coach'], ATHLETE_BY_ID['banana']),
                           'b': (ATHLETE_BY_ID['genius'], ATHLETE_BY_ID['legs'])})
    state = room.engine.select_racers(state, 'a', ('coach', 'banana')).state
    room.game_state = room.engine.select_racers(state, 'b', ('genius', 'legs')).state
    decision = room.game_state.pending_decision
    assert decision['playerId'] == 'b'
    await toggle(manager, room, 'a', True)
    await manager.handle_intent(room, 'a', ResolveDecisionIntent(type='RESOLVE_DECISION', actionId='spoof',
                               decisionId=decision['id'], optionId=decision['options'][0]['id']))
    assert room.players['a'].socket.messages[-1]['code'] == 'NOT_DECIDING_PLAYER'
    assert room.game_state.pending_decision == decision
