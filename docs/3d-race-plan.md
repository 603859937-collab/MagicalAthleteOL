# 全 3D 比赛桌实现方案

> 状态：已确认的目标方案，尚未全部实现
> 固化日期：2026-07-12
> 适用范围：比赛桌、赛道、赛车手棋子、全部骰子及其物理表现

本文档固化 Magical Athlete 的全 3D 表现方向和实施顺序。规则真值仍以 `docs/rules.md` 和服务端状态机为准；本文只定义客户端如何把权威状态呈现为一个有实体感的桌游场景。

## 1. 已锁定的产品方向

以下结论作为实现约束，后续不在开发过程中临时改变：

1. 比赛阶段的桌面、棋盘、格子、棋子、骰子、阴影和碰撞反馈必须全部处于同一个 Three.js 场景、同一个 Rapier 物理世界中。
2. 使用一个固定的倾斜透视视角。玩家不能旋转、平移或缩放相机；响应式布局只允许调整相机距离和取景范围，不改变观察方向。
3. 使用一个固定方向主光，光源不跟随骰子、棋子或当前玩家移动。只允许增加低强度、无方向的环境补光以保证暗部可读。
4. 正常棋子是立在底座上的 3D 立牌。第一版复用现有 36 张透明赛车手素材，不把 36 个定制雕刻模型作为上线前置条件。
5. 骰子直接投掷在同一张桌面的内场投骰区，不再放在独立的 3D 骰子卡片中。
6. `move` 必须逐格行走，前进和后退都一样；`warp` 直接传送，不能伪装成逐格移动。
7. 棋子与骰子、棋子与棋子接触时必须有可见反馈，但物理结果不得改变任何规则状态。
8. 绊倒由规则事件或权威快照驱动：立牌旋转至平放并保持；恢复时再扶起。普通物理碰撞绝不能产生逻辑绊倒。
9. 大厅、选秀、角色卡、玩家操作、技能选择和计分信息继续使用 React/HTML。它们是桌面上的操作界面，不做成难以阅读和操作的 3D 文字。
10. 最终目标覆盖主要移动单骰、招募/赛前判先手双骰，以及 Duelist 等角色产生的能力骰；所有骰子复用同一套桌面、物理和权威结果收敛逻辑。

## 2. 当前基线与主要差距

当前实现已经具备可复用基础：

- `RaceTrack.tsx` 使用 PixiJS 绘制 2D 棋盘和棋子，并已有 0-30 格的路径映射。
- `RaceDice.tsx` 已使用 React Three Fiber、Rapier 和服务端权威点数，实现动态刚体投掷和最终骰面收敛。
- `App.tsx` 已区分权威快照与展示快照，并按消息 revision 排队播放骰子、移动和技能事件。
- 服务端是唯一权威状态机，已经广播移动、传送、绊倒、恢复、完赛等基础事件。

现有结构不能直接满足目标，原因如下：

- 棋盘和骰子位于两个独立 Canvas，彼此没有共享坐标、光照或碰撞。
- 2D 路径、Wild Wilds 特殊格和同格偏移是组件内硬编码，缺少独立测试。
- 当前回放只处理 `RACER_MOVED`、`RACER_WARPED`、`RACER_TRIPPED` 和 `ABILITY_TRIGGERED`，没有完整处理恢复、交换、完赛和淘汰。
- Wild Wilds 的绊倒格目前直接改变底层 `tripped` 状态，未必产生可按顺序播放的 `RACER_TRIPPED`。
- `TRIP_RECOVERED` 已由服务端广播，但前端尚未把它纳入动画队列。
- 双赛车手模式只有 `activePlayerId`，不足以在掷骰前准确高亮当前行动棋子。
- Duelist 的能力会直接在规则引擎内掷两颗对抗骰，当前没有对应的公开骰子事件和 `rollResults`，无法做全量物理呈现。
- 同时移动和交换缺少可靠的事件分组信息；按数组顺序播放会把同时交换错误呈现为先后移动。
- 淘汰棋子的内部位置可以是 `null`，当前公开快照会把它折算成起点 0，3D 场景可能错误地让棋子返回起点。

因此，全 3D 不是把 Pixi 图形换成几个 mesh，而是先补齐表现契约，再替换渲染器。

## 3. 权威状态与表现状态

### 3.1 唯一真值

服务端快照和事件是唯一规则真值：

- 骰子点数、移动终点、是否绊倒、是否恢复、是否完赛、是否淘汰、积分和胜负都只能来自服务端。
- 客户端只提交玩家意图，不能提交物理解算后的点数、位置或碰撞结果。
- Rapier 只计算骰子飞行、接触和视觉反馈，不能反向修改 `position`、`tripped`、`finishPosition` 或服务端状态。

### 3.2 两层位姿

每个棋子必须拆成两层：

- `authority root`：由格子、同格槽位和权威状态计算出的稳定位置，任何动画结束后都回到这里。
- `visual child`：负责迈步抬升、轻微晃动、受击、平放和扶起，不拥有逻辑位置。

棋子使用 kinematic body。动态碰撞可以让视觉子节点晃动，但不能把根节点推离权威格位。

### 3.3 对齐策略

- 实时 `STATE_UPDATED.events` 按顺序或显式并行组消费。
- 一条消息播放完后，必须用同一消息中的最终 `game` 快照校正全部棋子和骰子状态。
- `WELCOME`、重连和 revision 跳跃不回放旧历史，直接按最新快照摆放。
- 页面进入后台或队列积压时允许缩短/跳过中间动画，但必须释放 `playbackBusy` 并落到最新权威快照。
- 快照中的 `tripped=true` 直接平放，不能要求先收到历史 `RACER_TRIPPED`。

## 4. 单场景架构

目标结构如下：

```text
React DOM
├── 顶栏、分数、当前玩家、角色卡
├── 技能选择和错误提示
└── TabletopScene（单一 Canvas）
    ├── FixedCameraRig
    ├── FixedLightRig
    ├── Physics（单一 Rapier world）
    │   ├── TableAndBounds（fixed）
    │   ├── TrackBoard（fixed）
    │   ├── RacerFleet（kinematic）
    │   └── DiceSet（dynamic）
    └── PresentationDirector
        ├── authoritative snapshot
        ├── event -> command planner
        └── animation queue / cancellation / reconcile
```

建议按现有仓库风格落在 `apps/web/src/components/race3d/`：

```text
race3d/
├── RaceTableScene.tsx
├── cameraRig.ts
├── lightingRig.ts
├── trackLayout.ts
├── TrackBoard.tsx
├── RacerPiece.tsx
├── RacerFleet.tsx
├── RaceDie.tsx
├── collisionGroups.ts
├── presentationCommands.ts
└── PresentationDirector.ts
```

现有 `diceOrientation.ts`、`diceLifecycle.ts` 和 `rollPresentation.ts` 保留为纯逻辑模块并复用。第一版不引入新的动画或后处理依赖，使用 R3F `useFrame`、Three.js 插值和 Rapier 完成。

## 5. 坐标、棋盘与占位

### 5.1 世界坐标

- 桌面使用 XZ 平面，Y 轴向上。
- 棋盘长边沿 X 轴，短边沿 Z 轴。
- 格子编号固定为起点 `0`、赛道 `1..30`；世界坐标不能进入服务端协议。
- `trackLayout` 为每格提供 `position`、`tangent`、格子尺寸和可用占位槽。
- 投骰区位于棋盘内场或棋盘旁的同一桌面上，必须处于相机完整取景和物理边界内。

### 5.2 棋盘实现

- Mild Mile 和 Wild Wilds 使用同一套 30 格路径几何，替换中场装饰和特殊格标记。
- 棋盘主体、格子和边框使用有厚度的几何体，不把实拍参考图直接铺成材质。现有 `docs/mildmile.png` 与 `docs/wildwilds.png` 只作为造型和配色参考。
- 共享材质和几何体应实例化，避免为每个格子创建独立高成本资源。
- 服务端公开逻辑赛道定义 `id/version/length/spaces`；客户端只负责把逻辑格映射到世界坐标，避免 Wild Wilds 效果在 Python 和 TypeScript 中继续各维护一份。

### 5.3 同格占位

共享一格是合法规则状态，不能被物理碰撞阻止：

- 每格最多容纳 6 枚棋子，使用固定的 2x3 槽位。
- 槽位分配按玩家顺序和 `athleteId` 稳定排序，所有客户端和重连后必须得到相同结果。
- 棋子进入或离开共享格时，其余棋子可以短距离平滑重排，但最终槽位必须确定。
- 平放棋子仍占用自己的槽位；其平放方向由赛道切线决定，不能压住相邻格的棋子。
- 起点和领奖区可使用更宽的专用槽位，但仍使用同一稳定排序规则。

## 6. 相机、灯光和响应式

### 6.1 固定相机

- 使用 PerspectiveCamera，固定方位角、俯角和观察目标，不启用 OrbitControls。
- 桌面端和移动端保持同一观察方向；只根据场景包围盒计算 camera distance、FOV 上限和轻微 target offset。
- 完整棋盘、起点、终点、投骰区和所有棋子在任何支持视口都必须可见。
- 比赛过程中禁止镜头切换、跟拍和抖动。能力效果只作用于棋子或局部视觉，不移动相机。

### 6.2 固定灯光

- 一个固定 directional key light 负责方向、立体感和阴影。
- 一个低强度 ambient/hemisphere fill 只补足暗部，不制造第二个明显光向。
- 只有主光投射阴影；阴影贴图尺寸和相机范围固定，不随棋子移动反复扩张。
- 不使用会移动的点光、彩色光球、镜头相关光源或重型后处理。

### 6.3 响应式与降级

- 3D 主场景使用稳定的 `aspect-ratio` 和最小/最大高度，DOM HUD 不能遮挡棋盘或投骰区。
- DPR 设上限：桌面最多 2，移动端建议最多 1.5；阴影质量可以按能力档位降级。
- `prefers-reduced-motion` 仍显示静态 3D 场景，但缩短或取消迈步、晃动、倒地和镜头外的物理过程。
- WebGL 不可用时提供语义完整的 HTML/静态 2D 降级，仍能看位置、点数、绊倒状态并完成操作。

## 7. 棋子方案

第一版棋子使用“有厚度的立牌”方案：

- 正面和背面使用现有 `public/assets/racer-tokens/*.webp` 透明素材。
- 立牌包含薄片主体、深色描边/背板和玩家颜色底座。
- 相机固定，因此立牌只需固定朝向主要观察方向，不使用始终追随相机的自由 billboard。
- collider 使用简化 capsule/cuboid，不根据透明轮廓生成复杂碰撞体。
- 正常状态竖直；`tripped` 状态围绕底边铰接旋转约 90 度并降低到桌面；恢复执行反向动画。
- 完赛棋子移动至终点/领奖槽，淘汰棋子移动至桌外退场槽，不复用起点位置。

后续可以按角色逐步替换为 GLB 模型，但模型根节点、尺寸、朝向、底座和 collider 必须遵守同一 `RacerPiece` 接口，不能改动回放契约。

## 8. 骰子与权威结果

现有骰子生命周期继续使用，但迁入统一场景：

1. 当前玩家拖拽或点击主要移动骰时只发送一次 `ROLL_DICE` 意图。
2. 主要移动的 `ROLL_STARTED` 让其他客户端用相同 throw key 自动启动投掷表现。
3. 骰子作为 dynamic rigid body 在投骰区与桌面、边界和棋子发生真实接触。
4. 服务端 `rollResults.id` 和 `values` 到达后成为唯一权威点数。
5. 骰子自然运动一段时间后进入 settling，平滑收敛到权威顶面；物理朝上的随机面不能覆盖服务端点数。
6. 超时、出界或休眠失败时，把骰子重置到投骰区并显示权威面，不能阻塞事件队列。
7. 一次掷骰的所有客户端最终显示相同顶面；不要求中间每一帧的物理轨迹完全一致。

`DiceSet` 必须支持可变骰子数量：主要移动通常使用 1 颗；招募和赛前判先手使用 2 颗；Duelist 使用 2 颗分别代表挑战者与目标。所有可见掷骰都进入统一的权威结果契约：

```text
rollResults[]
├── id：全局稳定的结果 ID
├── kind：MAIN_ROLL | ROLL_OFF | ABILITY_ROLL
├── values：按参与者顺序排列的点数
├── participants：每颗骰子对应的 playerId / athleteId
└── abilityName：仅能力骰需要
```

相关事件只引用 `rollResultId`。Duelist 等目前直接调用 RNG 的能力必须先产生公开 `ABILITY_DICE_ROLLED` 事件和结果，再播放后续能力与移动。物理场景不重新计算胜者。

## 9. 移动、姿态与事件时间线

当前 `App.tsx` 中基于 `setTimeout` 和快照克隆的回放应抽成可测试的 command planner。场景只消费命令，不直接理解 WebSocket 消息。

| 权威事件 | 表现命令 | 必须保持的语义 |
| --- | --- | --- |
| `START_DICE_ROLLED` | `SETTLE_DICE_SET` | 两颗判先手骰按服务端顺序展示和比较 |
| `DICE_ROLLED` | `SETTLE_DIE` | 顶面使用服务端点数 |
| `ABILITY_DICE_ROLLED` | `SETTLE_DICE_SET` | 每颗骰子按 participant 对齐，胜者由服务端决定 |
| `RACER_MOVED` | `STEP_PATH` | 从 `from` 到 `to` 每格一步，支持正向和反向 |
| `RACER_WARPED` | `WARP_TO` | 原地离开并在目标格出现，不经过中间格 |
| `RACERS_SWAPPED` | `SWAP_GROUP` | 两枚棋子并行换位，不能按先后占位解释 |
| `RACER_TRIPPED` | `LAY_DOWN` | 平放后保持，不能自动弹起 |
| `TRIP_RECOVERED` | `STAND_UP` | 跳过主要移动时扶起，不播放骰子 |
| `RACER_FINISHED` | `FINISH` | 越过终点并进入确定的完赛槽 |
| `RACER_ELIMINATED` | `EXIT` | 离场，不返回起点 |
| `ABILITY_TRIGGERED` | `ABILITY_CUE` | 短暂高亮来源和目标，不阻塞过久 |
| `TURN_CHANGED` | `SET_ACTIVE` | 使用事件 `athleteId` 高亮准确的当前棋子 |

`STEP_PATH` 的每一步由三个子阶段组成：朝向下一格、短距离抬升/前移、落入该格槽位。基础时长建议为每格 160-220ms；队列积压或 reduced motion 时可以压缩，但不能跳错终点。

协议前置工作必须包含：

- 当前行动棋子的公开身份统一使用现有的 `athleteId`，不暴露 magsim 内部 racer index。快照增加 `activeAthleteId`，`ROLL_STARTED` 和 `TURN_CHANGED` 都携带同一个 `athleteId`，解决双赛车手模式的当前棋子识别。
- 所有可见掷骰进入带 `kind/participants` 的统一 `rollResults`；Duelist 等能力骰必须产生 `ABILITY_DICE_ROLLED`，不能只写服务端日志。
- 让所有绊倒来源，包括 Wild Wilds 绊倒格，都稳定产生 `RACER_TRIPPED`。
- 把 `TRIP_RECOVERED`、`RACER_FINISHED`、`RACER_ELIMINATED` 纳入前端事件类型和播放队列。
- 为同时移动/传送提供规则级 `resolutionGroupId` 和 `resolutionMode`，或提供包含完整参与者和起终点的原子交换事件。
- 移动事件明确 `motion=STEP|WARP|PUSH|SWAP` 和来源棋子，避免长期依赖能力名称字符串猜测表现。
- 淘汰位置使用 `number | null`，不能把 `null` 转成 0。
- 实时事件具有稳定的 `sequence/eventId`；`raceLog` 记录恢复和淘汰，便于日志与重连诊断。
- 服务端公开赛道逻辑定义；3D 世界坐标继续只存在客户端。

## 10. 碰撞边界

### 10.1 物理碰撞矩阵

| 接触双方 | Rapier 行为 | 可见反馈 | 规则影响 |
| --- | --- | --- | --- |
| 骰子 - 桌面/边界 | 真实刚体碰撞 | 弹跳、滚动、阴影 | 无 |
| 骰子 - 棋子 | 骰子反弹，棋子根节点不位移 | 棋子短暂晃动 | 无，不会绊倒 |
| 移动棋子 - 棋子 | sensor/kinematic 接触 | 双方轻微摆动、落格冲击 | 无，不阻塞共享格 |
| 棋子 - 棋盘 | 权威路径约束 | 落步反馈 | 无 |

### 10.2 规则碰撞与视觉接触

- `PUSH` 使用更强的定向受击反馈，但目标终点仍来自服务端事件。
- 移动棋子进入已占用格时，客户端可从当前展示占位生成 `PIECE_CONTACT` 表现命令，不需要新增通用服务端 `COLLISION` 规则事件。
- “经过”和“共享一格”是规则术语，不等于模型在某一帧相交。若需要专门展示经过能力，应由服务端公开 `RACER_PASSED`，不能用 Rapier 碰撞猜测。
- 任何碰撞结束后都要回到确定的格子槽位。物理引擎不能决定谁被推出、谁倒下或谁进入下一格。

## 11. 分阶段实现路径

### M0：契约与技术验证

交付：

- 固化本方案并补齐事件类型设计。
- 建立单 Canvas、固定相机、固定灯光、桌面、1 颗骰子和 6 个 kinematic 占位物的 spike。
- 验证骰子能撞桌面和棋子，棋子视觉晃动后仍回到权威位置。
- 为 0、转角、30 格和 6 人同格槽位建立纯函数测试。

通过门槛：桌面和移动端完整取景；碰撞不改变棋子根坐标；技术验证不依赖 Pixi。

### M1：静态 3D 棋盘等价替换

交付：

- 实现 Mild Mile、Wild Wilds、起点、终点、特殊格和内场投骰区。
- 使用权威快照摆放 1-6 枚立牌，支持正常、绊倒、完赛和淘汰初始姿态。
- 旧 Pixi 跑道暂时保留为开发对照，通过临时 feature flag 切换。

通过门槛：两张地图所有格位映射正确；刷新或重连后棋子没有跳格和重叠。

### M2：表现时间线与棋子动画

交付：

- 把事件解析、队列、取消、快进和最终快照校正从 `App.tsx` 抽到 presentation controller。
- 完成逐格前进/后退、传送、同时交换、推动、绊倒、恢复、完赛和淘汰。
- 补齐 `activeAthleteId`、事件中的 `athleteId`、特殊格绊倒事件、同时事件分组和 nullable 淘汰位置。

通过门槛：所有事件都有单测；双赛车手当前棋子正确；trip -> skipped turn -> recover 连续且不投骰。

### M3：骰子并入同一桌面

交付：

- 将 `RaceDice` 的刚体、交互、权威骰面和超时恢复迁入 `RaceTableScene`。
- 删除比赛页面上的独立骰子 Canvas/卡片。
- 本地玩家、远端玩家、重掷和决策预览继续共享一致结果 ID。

通过门槛：单 Canvas 同时看到棋盘、棋子和骰子；所有客户端最终骰面一致；骰子出界或物理未休眠不会卡住回放。

### M4：碰撞反馈、全部骰子与视觉完善

交付：

- 加入骰子撞棋子、棋子落入占用格、PUSH 和共享格重排的差异化反馈。
- 判先手阶段复用桌面场景显示并投掷两颗骰子。
- Duelist 等能力触发时生成带参与者标识的能力骰，播放后再继续对应能力时间线。
- 完善材质、接触阴影、底座玩家色、当前棋子高亮和 reduced-motion 路径。

通过门槛：碰撞清楚可见但不造成规则漂移；判先手与能力骰的数量、参与者、结果和胜者均与服务端一致。

### M5：响应式、性能、降级与切换

交付：

- 完成桌面/移动端取景、DPR/阴影档位、WebGL 降级、页面后台快进和资源释放。
- 通过多客户端、断线重连、revision 跳跃和四场连续切图测试。
- 默认切换到 3D；删除 `RaceTrack`、旧独立骰盘及未使用的 PixiJS 依赖和临时 feature flag。
- 3D 切换完成后再把 README 的“当前架构”改成统一 R3F/Rapier。

通过门槛：验收矩阵全部通过，生产代码不再长期维护两套跑道渲染器。

## 12. 测试与验收

### 12.1 自动化测试

前端纯逻辑测试至少覆盖：

- `tile -> world position/tangent`：起点、直线、两个转角、终点和反向路径。
- 1-6 枚棋子的稳定槽位、加入/离开重排和重连一致性。
- `event -> presentation command`：step、warp、swap、push、trip、recover、finish、eliminate。
- 顺序组、并行组、取消、快进、队列积压和最终 snapshot reconcile。
- 骰面朝向、权威结果去重、reset、超时，以及 MAIN_ROLL/ROLL_OFF/ABILITY_ROLL 生命周期。

服务端测试至少覆盖：

- Wild Wilds 绊倒格产生一次可靠的 `RACER_TRIPPED`。
- 绊倒赛车手下一回合产生 `TRIP_RECOVERED`，且没有 `DICE_ROLLED`。
- 招募/赛前判先手产生含两颗骰子的 `ROLL_OFF` 结果，并与 `START_DICE_ROLLED` 使用同一个结果 ID。
- `activeAthleteId` 以及 `ROLL_STARTED`/`TURN_CHANGED.athleteId` 在普通和双赛车手模式正确推进。
- Duelist 产生两颗带 participant 的 `ABILITY_ROLL`，结果和胜者均来自服务端。
- swap/simultaneous movement 的原子参与者、分组和起终点完整。
- finish/eliminate 的公开位置和状态不会回到起点。

浏览器测试至少覆盖：

- Playwright 在 1440x900 和 390x844 截图；完整棋盘、投骰区和 HUD 不重叠。
- canvas 像素检查确认非空、资产已加载且不是纯背景色。
- 物理启动前后截图或探针确认骰子发生位移并最终停止在权威面。
- 2 人 4 枚棋子、3 人双赛车手 6 枚棋子和 6 人 6 枚棋子均无不可读重叠。
- 多客户端执行 roll -> step、warp/swap/push、trip -> recover、finish 和重连。

### 12.2 性能门槛

- 常见桌面设备目标 60fps，常见移动设备不低于 30fps。
- 只保留一个投影光源；限制阴影范围和分辨率。
- 共享/实例化格子几何与材质，避免每帧创建 Vector、材质或纹理。
- 3D 场景按比赛阶段懒加载，离开比赛后释放 rigid body、texture 和事件订阅。
- 不使用持续运行且没有可见作用的动画；骰子休眠后停止无效物理解算。

## 13. 完成定义

以下条件全部满足，才算全 3D 迁移完成：

- 比赛阶段只有一个 WebGL Canvas 和一个 Rapier world。
- 固定倾斜相机和固定灯光在桌面、手机视口都能完整展示棋盘与投骰区。
- 所有棋子正常时站立，绊倒时持续平放，恢复时扶起；重连姿态正确。
- 所有 `move` 逐格播放，warp 直接到达，swap 同时执行，push 有碰撞反馈。
- 主要移动、判先手和能力骰都直接投在桌面并与桌面、边界和棋子接触，最终点数始终服从服务端。
- 同格最多 6 枚棋子可读、不重叠，且碰撞不会改变规则位置或产生绊倒。
- revision 跳跃、断线重连、页面后台和动画超时最终都能对齐最新快照。
- reduced motion 和无 WebGL 环境仍可完整进行游戏。
- 单元、服务端、浏览器截图和 canvas 像素检查全部通过。
- Pixi 跑道、独立骰子 Canvas、迁移 feature flag 和未使用依赖已移除。

## 14. 明确不做

- 不让客户端物理引擎决定骰点、移动、绊倒、名次或积分。
- 不提供自由旋转、缩放、跟拍、镜头切换或动态灯光。
- 不把 36 个定制 3D 角色模型作为第一版前置条件。
- 不为了视觉碰撞改变“同格合法”“经过”“传送”等正式规则语义。
- 不在迁移完成后长期保留 Pixi 与 Three 两套比赛跑道实现。
