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
{ "type": "RESOLVE_DECISION", "actionId": "a7", "decisionId": "d1", "optionId": "1" }
{ "type": "ADVANCE_RACE", "actionId": "a8" }
```

`SET_VARIANT` 只由房主在三人大厅使用。两人游戏始终是双赛车手，4–6 人始终是单赛车手。`ROLL_START` 用于招募前和需要平局决胜的比赛前掷骰。比赛轮次由服务端自动推进到技能选择或 `WAITING_FOR_ROLL`；`ROLL_DICE` 只在后者有效，并从服务端生成骰点后执行到本回合结束或下一个技能选择，不接受客户端点数或移动终点。`RESOLVE_DECISION` 只接受公开候选项中的 ID，且只能由 `pendingDecision.playerId` 提交。

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

比赛状态还包含 `pendingDecision`、`raceLog` 和 `resolutionStatus`。`resolutionStatus` 在轮次等待玩家掷骰时为 `WAITING_FOR_ROLL`，技能选择期间为 `WAITING_FOR_DECISION`。候选项对房间内所有玩家公开；待选状态包含 60 秒的 `deadlineAt`，超时后服务端采用该能力的 SmartAgent 推荐并继续。重连会恢复同一个决策 ID 和截止时间。

## 状态广播

有效行动产生 `STATE_UPDATED`。`events` 用于移动动画和提示，`game` 是权威快照；客户端发现 revision 跳跃时直接采用最新快照。骰子结果通过 `rollResults` 明确广播给房间内所有客户端，每个结果带全局一致的 `id`，客户端必须以此字段中的 `values` 为权威点数。`rollSerial` 在单场比赛内单调递增；一次待决策预览及其最终事件共享同一个序号和结果 ID。

比赛掷骰被服务端确认后，会先广播不改变 revision 的 `ROLL_STARTED`，供所有客户端同步启动投掷动画；实际点数仍只在随后的 `STATE_UPDATED.events` 中公布。

```json
{
  "type": "STATE_UPDATED",
  "roomId": "ABCD",
  "revision": 18,
  "rollResults": [
    { "id": "race:2:serial:7", "playerId": "p1", "athleteId": "centaur", "values": [5], "rollSerial": 7, "baseValue": 5, "finalValue": 5 }
  ],
  "events": [
    { "type": "DICE_ROLLED", "playerId": "p1", "athleteId": "centaur", "value": 5 },
    { "type": "RACER_MOVED", "playerId": "p1", "athleteId": "centaur", "from": 4, "to": 9, "movementKind": "FORWARD" },
    { "type": "TURN_CHANGED", "playerId": "p2" }
  ],
  "game": { "phase": "RACING", "raceNumber": 2, "activePlayerId": "p2" }
}
```

比赛事件包括 `DICE_ROLLED`、`ABILITY_TRIGGERED`、`DECISION_REQUIRED`、`DECISION_RESOLVED`、`DECISION_TIMED_OUT`、`RACER_MOVED`、`RACER_TRIPPED`、`TRIP_RECOVERED`、`RACER_WARPED`、`RACERS_SWAPPED`、`RACER_FINISHED`、`RACER_ELIMINATED` 和 `TURN_CHANGED`。客户端按数组顺序播放，最后以同一消息中的 `game` 快照对齐。

`RACER_MOVED.movementKind` 区分 `FORWARD`、`BACKWARD` 和 `PUSH`；`RACER_WARPED.movementKind` 可为 `WARP`、`SWAP` 或 `PUSH`。这些字段描述规则动作的种类，客户端物理碰撞不能据此反向修改游戏状态。`TRIP_RECOVERED` 表示该赛车手跳过本次主要移动并恢复正常状态，因此同一回合不会伴随 `DICE_ROLLED`。

全 3D 表现所需的事件归一化、同时事件分组和当前赛车手契约记录在 `docs/3d-race-plan.md`。这些目标字段完成服务端实现和测试前，不视为当前协议已经提供。

## 错误

格式或规则错误返回：

```json
{ "type": "ERROR", "code": "NOT_YOUR_TURN", "message": "还没轮到你", "actionId": "a6" }
```
