# Magical Athlete Online

Magical Athlete 的多人网页版本骨架。它把浏览器当作“玩家意图输入 + 状态展示”，所有掷骰、移动、能力触发和回合推进都由服务端权威状态机决定。

## 架构

```text
apps/web (React + TypeScript + PixiJS)
    │  JSON / WebSocket
    ▼
apps/server (FastAPI)
    ├── RoomManager：连接、重连、广播、房间生命周期
    └── GameEngine：纯状态转换端口
          └── DemoGameEngine（之后替换为 magsim adapter）
```

- `apps/web`：房间 UI 使用 React/HTML/CSS，跑道动画由 PixiJS 渲染。
- `apps/server`：WebSocket 接收玩家意图，串行修改房间状态并广播事件。
- `docs/protocol.md`：连接、消息和版本约定。
- `infra/Caddyfile`：生产环境同域反向代理，避免额外的跨域配置。

当前示例规则是一条 20 格跑道，2–4 人加入后由房主开局。服务端为每人无重复发放四张角色牌，所有人秘密锁定本场角色后同时揭示，再轮流掷骰，先到终点者获胜。角色能力目前只展示说明、尚未影响比赛；这个流程用于打通完整链路，不是替代 `magsim` 的正式规则。

## 本地运行

需要 Node.js 20+ 与 Python 3.12+。推荐安装 [uv](https://docs.astral.sh/uv/)。

```bash
# 终端 1
cd apps/server
uv sync --extra dev
uv run uvicorn magical_athlete.main:app --reload

# 终端 2
cd apps/web
npm install
npm run dev
```

打开 `http://localhost:5173`。前端开发服务器会把 `/api` 与 `/ws` 代理到 `localhost:8000`。

也可以直接运行：

```bash
docker compose up --build
```

然后打开 `http://localhost:8080`。

## 接入 magsim

后端只依赖 `GameEngine` 协议，接入时新增 `MagsimGameEngine`，实现：

1. `create_game(players)`：把房间玩家映射成 magsim 初始局面；
2. `handle_intent(state, player_id, intent)`：校验行动者与阶段，调用 magsim，返回新状态和领域事件；
3. `public_state(state)`：剔除其他玩家不可见信息，生成广播快照。

房间管理、WebSocket、断线重连和前端协议不需要跟着重写。生产阶段再把 `InMemoryRoomRepository` 换成 Redis/PostgreSQL 实现。
