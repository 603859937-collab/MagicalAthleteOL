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
          └── MagsimGameEngine（复用 vendored magsim 规则）
```

- `apps/web`：房间 UI 使用 React/HTML/CSS，跑道动画由 PixiJS 渲染。
- `apps/server`：WebSocket 接收玩家意图，串行修改房间状态并广播事件。
- `docs/protocol.md`：连接、消息和版本约定。
- `docs/rules.md`：项目实现必须固化遵守的实体规则常量。
- `infra/Caddyfile`：生产环境同域反向代理，避免额外的跨域配置。

当前规则由服务端 `MagsimGameEngine` 驱动，底层复用 `apps/server/src/magsim` 中 vendored 的 Magical Athlete 模拟器实现。2–4 人加入后由房主开局，服务端为每人无重复发放四张角色牌，所有人秘密锁定本场角色后同时揭示。玩家发起一次 `ROLL_DICE` 会执行当前角色在 magsim 中的完整 turn，包括掷骰、移动、反应事件、回合结束和下一位 active racer 推进。

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

## magsim 代码来源

`apps/server/src/magsim` 是从上游 `magsim` 包 vendored 进来的普通 Python 模块，服务端代码直接 `import magsim`。更新上游规则时，重新同步该目录和 `apps/server/THIRD_PARTY_LICENSES/magsim-LICENSE`，再跑 server 测试确认 adapter 事件映射没有回归。

房间管理、WebSocket、断线重连和前端协议仍然隔离在 `RoomManager` 和 `GameEngine` 协议之后。生产阶段再把 `InMemoryRoomRepository` 换成 Redis/PostgreSQL 实现。
