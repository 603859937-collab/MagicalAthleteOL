# WebSocket 协议

客户端连接同域 `/ws`。消息使用 UTF-8 JSON；服务端按房间串行处理玩家意图，并在每次有效状态变化后增加 `revision`。

## 建立会话

WebSocket 建立后第一条消息必须是 `JOIN_ROOM`：

```json
{ "type": "JOIN_ROOM", "roomId": "ABCD", "playerName": "Alice" }
```

服务端在 `WELCOME` 中返回只保存在该玩家浏览器的 `playerId` 与 `reconnectToken`。断线后在 `JOIN_ROOM` 中附带这两个字段即可恢复身份。

## 玩家行动

所有状态行动都包含客户端生成的唯一 `actionId`：

```json
{ "type": "SET_VARIANT", "actionId": "a1", "doubleRacer": true }
{ "type": "START_GAME", "actionId": "a2" }
{ "type": "ROLL_START", "actionId": "a3" }
{ "type": "DRAFT_ATHLETE", "actionId": "a4", "athleteId": "centaur" }
{ "type": "SELECT_RACERS", "actionId": "a5", "athleteIds": ["centaur", "banana"] }
{ "type": "ROLL_DICE", "actionId": "a6" }
{ "type": "ADVANCE_RACE", "actionId": "a7" }
```

`SET_VARIANT` 只由房主在三人大厅使用。两人游戏始终是双赛车手，4–6 人始终是单赛车手。`ROLL_START` 用于招募前和需要平局决胜的比赛前掷骰。`ROLL_DICE` 在服务端执行当前赛车手的完整回合，不接受客户端点数或移动终点。

重复的 `actionId` 不会重复执行，服务端返回 `ACTION_ACK`。

## 游戏阶段

权威状态 `game.phase` 按以下流程推进：

```text
LOBBY
  -> DRAFT_ROLL -> DRAFTING
  -> RACE_ROLL -> CHARACTER_SELECTION -> RACING -> RACE_RESULTS
  -> CHARACTER_SELECTION / RACE_ROLL ...
  -> FINISHED
```

`DRAFTING` 公开 `draftPool`、`activePlayerId`、各玩家 `team` 与招募轮次。`CHARACTER_SELECTION` 只公开 `selectionLocked`；全部玩家锁定后，`activeRacers` 同时揭示。`raceNumber` 为 1–4，`trackName`、`raceRewards` 和 `scores` 始终来自服务端。

## 状态广播

有效行动产生 `STATE_UPDATED`。`events` 用于动画和提示，`game` 是权威快照；客户端发现 revision 跳跃时直接采用最新快照。

比赛掷骰被服务端确认后，会先广播不改变 revision 的 `ROLL_STARTED`，供所有客户端同步启动投掷动画；实际点数仍只在随后的 `STATE_UPDATED.events` 中公布。

```json
{
  "type": "STATE_UPDATED",
  "roomId": "ABCD",
  "revision": 18,
  "events": [
    { "type": "DICE_ROLLED", "playerId": "p1", "athleteId": "centaur", "value": 5 },
    { "type": "ATHLETE_MOVED", "playerId": "p1", "athleteId": "centaur", "from": 4, "to": 9 },
    { "type": "TURN_CHANGED", "playerId": "p2" }
  ],
  "game": { "phase": "RACING", "raceNumber": 2, "activePlayerId": "p2" }
}
```

## 错误

格式或规则错误返回：

```json
{ "type": "ERROR", "code": "NOT_YOUR_TURN", "message": "还没轮到你", "actionId": "a6" }
```
