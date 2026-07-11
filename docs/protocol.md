# WebSocket 协议

客户端连接同域 `/ws`。消息使用 UTF-8 JSON；服务端按房间串行处理玩家意图，并在每次有效状态变化后增加 `revision`。

## 建立会话

WebSocket 建立后，第一条消息必须是：

```json
{
  "type": "JOIN_ROOM",
  "roomId": "ABCD",
  "playerName": "Alice"
}
```

服务端返回 `WELCOME`，其中的 `playerId` 与 `reconnectToken` 只保存在该玩家浏览器中。断线后使用相同消息并附带这两个字段即可恢复身份。

## 玩家行动

每个改变状态的行动都必须包含客户端生成的唯一 `actionId`：

```json
{ "type": "START_GAME", "actionId": "9af4..." }
{ "type": "SELECT_ATHLETE", "actionId": "3e71...", "athleteId": "centaur" }
{ "type": "ROLL_DICE", "actionId": "16b2..." }
```

重复的 `actionId` 不会重复执行，服务端返回 `ACTION_ACK`。客户端只发送意图，不发送骰子点数、移动终点或胜负结果。

## 状态广播

有效行动产生 `STATE_UPDATED`：

```json
{
  "type": "STATE_UPDATED",
  "roomId": "ABCD",
  "revision": 8,
  "actionId": "16b2...",
  "events": [
    { "type": "DICE_ROLLED", "playerId": "p1", "value": 5 },
    { "type": "ATHLETE_MOVED", "athleteId": "p1", "from": 4, "to": 9 },
    { "type": "TURN_CHANGED", "playerId": "p2" }
  ],
  "game": {
    "phase": "RACING",
    "finishLine": 20,
    "players": [],
    "activePlayerId": "p2",
    "winnerId": null
  }
}
```

`events` 用于播放动画和提示，`game` 是权威快照。客户端发现 revision 跳跃时应直接以最新快照为准。

## 角色发牌与选择

房主发送 `START_GAME` 后，服务端从角色目录中为每位玩家无重复抽取四张牌，并进入 `CHARACTER_SELECTION`。`game.hand` 是按连接生成的私有字段，只包含当前玩家自己的手牌。

玩家发送 `SELECT_ATHLETE` 后即锁定，不能修改。锁定期间公共玩家状态只公开 `selectionLocked`，`selectedAthlete` 保持为 `null`；最后一名玩家锁定后，服务端同时公开全部 `selectedAthlete` 并进入 `RACING`。

## 错误

格式或规则错误返回：

```json
{
  "type": "ERROR",
  "code": "NOT_YOUR_TURN",
  "message": "还没轮到你",
  "actionId": "16b2..."
}
```

协议新增字段时保持向后兼容；出现破坏性改动时再增加显式协议版本。
