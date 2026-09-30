"""用机器人陪练一场真实对局，方便在浏览器里观看完整比赛。

先启动服务端与前端，再运行本脚本：

    make server
    make web
    apps/server/.venv/bin/python apps/server/scripts/play_match.py

脚本创建房间并派出若干机器人玩家，然后打印加入链接。在浏览器打开链接加入后，
人数达到 ``--min-players``（默认机器人数量 + 1，也就是等你）时机器人房主自动开局；
机器人会自己完成公开招募、秘密选将、掷骰与技能选择，陪你打满四场直到结算。
机器人只提交公开玩家指令，看到的状态和浏览器完全一致。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import urllib.error
import urllib.request
from typing import Any
from uuid import uuid4

import websockets


BOT_NAMES = ("机器人甲", "机器人乙", "机器人丙", "机器人丁", "机器人戊", "机器人己")
DECLINE_LABELS = ("不使用", "跳过", "放弃")
MAX_PLAYERS = 6
ACTION_LABELS = {
    "START_GAME": "开始比赛",
    "ROLL_START": "掷骰定序",
    "ROLL_DICE": "掷骰",
    "ADVANCE_RACE": "进入下一场",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="让机器人加入一场真实对局，方便在浏览器里观战")
    parser.add_argument("--server", default="http://localhost:8000", help="服务端地址")
    parser.add_argument(
        "--web",
        default="http://localhost:5173/MagicalAthleteOL",
        help="前端地址，仅用于打印加入链接",
    )
    parser.add_argument(
        "--origin",
        default="http://localhost:5173",
        help="WebSocket 的 Origin 头，必须在服务端 allowed_origins 里",
    )
    parser.add_argument("--room", help="加入已有房间；默认新建房间")
    parser.add_argument("--bots", type=int, default=2, help="机器人数量，默认 2")
    parser.add_argument(
        "--min-players",
        type=int,
        help="大厅凑满多少人就开局；默认机器人数量 + 1",
    )
    parser.add_argument(
        "--results-pause",
        type=float,
        default=3.0,
        help="每场结束后等多久再开下一场，留给浏览器播完结算，默认 3 秒",
    )
    parser.add_argument("--seed", type=int, help="技能选择的随机种子，便于复现同一场比赛")
    parser.add_argument(
        "--decline-skills",
        action="store_true",
        help="技能选择时优先选“不使用”，用于观察跳过分支",
    )
    return parser.parse_args(argv)


def create_room(server: str) -> str:
    request = urllib.request.Request(f"{server}/api/rooms", method="POST")
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)["roomId"]
    except urllib.error.URLError as error:
        raise SystemExit(f"无法连接服务端 {server}（{error.reason}）；请先运行 `make server`。") from error


def pick_intent(
    game: dict[str, Any],
    player_id: str,
    *,
    host: bool,
    min_players: int,
    rng: random.Random,
    decline_skills: bool,
) -> dict[str, Any] | None:
    """返回该机器人此刻应该提交的指令，规则与浏览器端保持一致。"""
    me = next((player for player in game["players"] if player["id"] == player_id), None)
    if me is None:
        return None
    phase = game["phase"]
    if phase == "LOBBY":
        if host and len(game["players"]) >= min_players:
            return {"type": "START_GAME"}
        return None
    if phase in {"DRAFT_ROLL", "RACE_ROLL"}:
        if player_id in game["rollCandidateIds"] and not me["rollValues"]:
            return {"type": "ROLL_START"}
        return None
    if phase == "DRAFTING":
        if game["activePlayerId"] == player_id and game["draftPool"]:
            return {"type": "DRAFT_ATHLETE", "athleteId": game["draftPool"][0]["id"]}
        return None
    if phase == "CHARACTER_SELECTION":
        if me["selectionLocked"]:
            return None
        picks = [
            athlete["id"]
            for athlete in me["team"]
            if athlete["id"] not in me["usedAthleteIds"]
        ][: game["selectionCount"]]
        if len(picks) == game["selectionCount"]:
            return {"type": "SELECT_RACERS", "athleteIds": picks}
        return None
    if phase == "RACE_RESULTS":
        return {"type": "ADVANCE_RACE"} if host else None
    if phase != "RACING":
        return None
    decision = game.get("pendingDecision")
    if decision is not None:
        if decision["playerId"] != player_id:
            return None
        usable = [option for option in decision["options"] if option["label"] not in DECLINE_LABELS]
        pool = decision["options"] if decline_skills or not usable else usable
        return {
            "type": "RESOLVE_DECISION",
            "decisionId": decision["id"],
            "optionId": rng.choice(pool)["id"],
        }
    if game.get("resolutionStatus") != "WAITING_FOR_ROLL":
        return None
    pending_roll = game.get("pendingRoll")
    roller = pending_roll["nextPlayerId"] if pending_roll else game["activePlayerId"]
    return {"type": "ROLL_DICE"} if roller == player_id else None


def summarize(intent: dict[str, Any]) -> str:
    kind = intent["type"]
    if kind == "DRAFT_ATHLETE":
        return f"招募 {intent['athleteId']}"
    if kind == "SELECT_RACERS":
        return f"锁定赛车手 {'、'.join(intent['athleteIds'])}"
    if kind == "RESOLVE_DECISION":
        return f"技能选择 {intent['optionId']}"
    return ACTION_LABELS.get(kind, kind)


def print_result(game: dict[str, Any]) -> None:
    scores = "，".join(
        f"{player['name']} {player['score']}"
        for player in sorted(game["players"], key=lambda player: -player["score"])
    )
    winners = [player["name"] for player in game["players"] if player["id"] in game["winnerIds"]]
    print(f"比赛结束：{'、'.join(winners)} 获胜（{scores}）", flush=True)


async def run_bot(
    args: argparse.Namespace,
    room_id: str,
    index: int,
    min_players: int,
    rng: random.Random,
) -> None:
    name = BOT_NAMES[index]
    host = index == 0
    uri = f"{args.server.replace('https://', 'wss://').replace('http://', 'ws://')}/ws"
    async with websockets.connect(uri, origin=args.origin, proxy=None) as socket:
        await socket.send(
            json.dumps({"type": "JOIN_ROOM", "roomId": room_id, "playerName": name})
        )
        player_id: str | None = None
        seen_revision = -1
        pending_action_id: str | None = None
        async for raw in socket:
            message = json.loads(raw)
            kind = message.get("type")
            if kind == "ERROR":
                if message.get("actionId") == pending_action_id:
                    pending_action_id = None
                print(
                    f"[{name}] 服务端拒绝：{message.get('code')} {message.get('message')}",
                    flush=True,
                )
                continue
            if kind == "WELCOME":
                player_id = message["playerId"]
                print(f"[{name}] 已进入房间 {room_id}", flush=True)
            if player_id is None or kind not in {"WELCOME", "STATE_UPDATED"}:
                continue
            if message["revision"] <= seen_revision:
                continue
            seen_revision = message["revision"]
            if message.get("actionId") == pending_action_id:
                pending_action_id = None
            if pending_action_id is not None:
                # 自己上一步还没被服务端确认，先别看别人的广播，免得重复提交同一件事。
                continue
            game = message["game"]
            if game["phase"] == "FINISHED":
                if host:
                    print_result(game)
                return
            intent = pick_intent(
                game,
                player_id,
                host=host,
                min_players=min_players,
                rng=rng,
                decline_skills=args.decline_skills,
            )
            if intent is None:
                continue
            if intent["type"] == "ADVANCE_RACE":
                await asyncio.sleep(args.results_pause)
            pending_action_id = uuid4().hex
            await socket.send(json.dumps({**intent, "actionId": pending_action_id}))
            print(f"[{name}] {summarize(intent)}", flush=True)
    print(f"[{name}] 连接已断开", flush=True)


async def drive(
    args: argparse.Namespace,
    room_id: str,
    bots: int,
    min_players: int,
    rng: random.Random,
) -> None:
    await asyncio.gather(
        *(run_bot(args, room_id, index, min_players, rng) for index in range(bots))
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    bots = max(1, min(args.bots, MAX_PLAYERS))
    if args.bots != bots:
        print(f"机器人数量需要在 1–{MAX_PLAYERS} 之间，已按 {bots} 处理", flush=True)
    min_players = bots + 1 if args.min_players is None else args.min_players
    if min_players < bots:
        print(f"开局人数不能少于机器人数量，已按 {bots} 处理", flush=True)
        min_players = bots
    elif min_players > MAX_PLAYERS:
        print(f"开局人数最多 {MAX_PLAYERS} 人，已按 {MAX_PLAYERS} 处理", flush=True)
        min_players = MAX_PLAYERS
    room_id = args.room or create_room(args.server)
    print(f"房间 {room_id}：{args.web}/#/room/{room_id}", flush=True)
    waiting = min_players - bots
    if waiting > 0:
        print(
            f"请在浏览器打开上面的链接加入，还差 {waiting} 人；人数凑齐后机器人自动开局。",
            flush=True,
        )
    else:
        print("房间已满员，机器人直接开局。", flush=True)
    try:
        asyncio.run(drive(args, room_id, bots, min_players, random.Random(args.seed)))
    except KeyboardInterrupt:
        print("已停止机器人", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
