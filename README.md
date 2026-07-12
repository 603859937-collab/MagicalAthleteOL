# Magical Athlete Online

Magical Athlete 的 2–6 人多人网页版本。浏览器只提交玩家意图，所有掷骰、移动、能力触发、计分和阶段推进都由服务端权威状态机决定。

## 架构

```text
apps/web (React + TypeScript + PixiJS / R3F + Rapier)
    │  JSON / WebSocket
    ▼
apps/server (FastAPI 本地 / Cloudflare Worker 生产)
    ├── RoomManager：连接、重连、广播、房间生命周期
    └── GameEngine：纯状态转换端口
          └── MagsimGameEngine（复用 vendored magsim 规则）
```

- `apps/web`：房间 UI 使用 React/HTML/CSS；当前跑道由 PixiJS 渲染，比赛骰子由独立的 React Three Fiber + Rapier 场景渲染。
- `apps/server`：WebSocket 接收玩家意图，串行修改房间状态并广播事件。
- `docs/protocol.md`：连接、消息和版本约定。
- `docs/rules.md`：项目实现必须固化遵守的实体规则常量。
- `docs/3d-race-plan.md`：已确认的全 3D 比赛桌目标架构、实施阶段和验收标准；实现完成前不代表当前渲染状态。
- `infra/Caddyfile`：生产环境同域反向代理，避免额外的跨域配置。

正式规则由服务端 `MagsimGameEngine` 驱动，底层复用 `apps/server/src/magsim` 中 vendored 的 36 角色规则。游戏包含公开蛇形招募、四场秘密选将、`Standard, Standard, WildWilds, WildWilds` 固定赛程和逐场累计积分。两人使用官方双赛车手规则；三人可由房主选择标准或双赛车手变体。

服务端会在轮次到达时自动结算回合开始能力，并推进到技能选择或 `WAITING_FOR_ROLL`。只有当前玩家此时发起的 `ROLL_DICE` 才会生成骰点并继续执行主要移动、反应、赛道格效果和回合结束；摔倒恢复或已消耗主移动的轮次会自动换手。第二名冲线后该场立即结束。

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

本地 FastAPI 使用进程内房间仓库。生产环境的 Cloudflare Worker 将请求按四位房间号路由到 Durable Object；每个对象串行执行房间行动，以带 `schemaVersion` 的服务端二进制快照保存游戏状态、重连身份和 `actionId` 去重集合。Durable Object alarm 恢复 60 秒技能选择超时，并在最后活动 24 小时后清理无连接、无待决策的房间。

## Cloudflare 与 GitHub Pages 部署

首次部署前，在 Cloudflare 创建仅用于此仓库的 API Token。最小权限为账户的 Workers Scripts 编辑、Workers Durable Objects 编辑；若账户界面把 Durable Objects 权限包含在 Workers Scripts 中，则不需要额外扩大权限。确认账户已启用 Python Workers、Durable Objects、WebSocket hibernation 和 alarms。

GitHub 仓库需要以下配置：

- Actions secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
- Actions variable：`CLOUDFLARE_API_ORIGIN=https://<worker>.<subdomain>.workers.dev`
- Settings > Pages > Source：`GitHub Actions`

推送 `main` 后，[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 会先运行 Python/前端测试与生产构建，再发布 Worker（首次发布同时应用 Durable Object `v1` migration），最后部署 `apps/web/dist`。站点地址为 `https://xeonliu.github.io/MagicalAthleteOL/`，分享链接格式为 `https://xeonliu.github.io/MagicalAthleteOL/#/room/ABCD`。

### 本地调试和发布 Cloudflare Worker

Pywrangler 当前需要 `uv >= 0.8.10`、Python 3.13 和 Node 20/22 LTS。不要使用 Node 26：Pyodide 3.13.2 会传入 Node 26 已移除的 `--experimental-wasm-stack-switching` 参数。macOS 可以并行安装 Node 22，而不必卸载现有 Node：

```bash
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version  # 应为 v22.x
```

在仓库根目录安装锁定依赖，然后启动本地 Worker：

```bash
uv sync
uv run pywrangler dev
curl http://localhost:8787/api/health
```

首次从本机发布时，可以在浏览器登录 Cloudflare：

```bash
export PATH="$(brew --prefix node@22)/bin:$PATH"
uv run pywrangler login
uv run pywrangler deploy --dry-run
uv run pywrangler deploy
```

也可以使用和 GitHub Actions 相同的 API Token，适合无浏览器或自动化环境：

```bash
export PATH="$(brew --prefix node@22)/bin:$PATH"
export CLOUDFLARE_ACCOUNT_ID="<account-id>"
export CLOUDFLARE_API_TOKEN="<api-token>"
uv run pywrangler deploy --dry-run
uv run pywrangler deploy
```

首次正式发布会创建 `RoomDurableObject` 的 `v1` migration。发布后用命令输出的 `workers.dev` 地址验证接口：

```bash
curl https://<worker>.<subdomain>.workers.dev/api/health
curl -X POST https://<worker>.<subdomain>.workers.dev/api/rooms
```

前端生产构建使用同一个 Worker 地址：

```bash
cd apps/web
VITE_API_ORIGIN=https://<worker>.<subdomain>.workers.dev npm run build
```

回滚 Worker 时用 Cloudflare Dashboard 的 Workers & Pages > Deployments 选择上一版本；Pages 可在 GitHub Actions 中重新运行先前成功提交。不要删除或回退 `wrangler.toml` 中已经应用的 migration tag。快照格式升级必须先增加兼容读取或显式迁移，不能直接覆盖 `schemaVersion`。
