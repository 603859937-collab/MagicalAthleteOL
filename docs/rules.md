# Magical Athlete 设计需求 / Design Requirements

本文档固化本项目实现《Magical Athlete》时必须遵守的规则和产品设计要求。英文规则术语参考 `docs/How_to_play_Magical_Athlete_compressed.pdf`；中文为项目实现说明。这里描述的是目标规则，不代表当前代码已经全部实现。

This document locks the rules and product requirements for this implementation of Magical Athlete. English terms follow `docs/How_to_play_Magical_Athlete_compressed.pdf`; Chinese text describes the project behavior. This is the target design, not a statement that the current code already implements every item.

## 总体原则 / General Principles

- 中文：不再保留或继续扩展 Demo Engine；游戏逻辑必须以正式规则为准。
- English: Do not keep or extend the Demo Engine; game logic must follow the official rules.

- 中文：服务端是权威状态机。客户端只发送玩家意图，不发送骰子点数、移动终点、名次或胜负结果。
- English: The server is authoritative. Clients send player intents only, never die values, movement destinations, placements, or results.

- 中文：必须支持完整角色池。规则书包含 36 名 racers，所有角色都应能进入招募、比赛和公开状态。
- English: Support the complete racer pool. The rulebook contains 36 racers, and every racer must be available for recruiting, racing, and public state.

- 中文：一整局游戏由四场比赛组成；第四场结束后，累计积分最高的玩家获胜。
- English: A full game has four races. After the fourth race, the player with the most total points wins.

- 中文：若最终积分并列，则保持并列，不做额外决胜。
- English: If final scoring is tied, it remains a tie; there is no tiebreaker.

- 中文：每名赛车手整局只能使用一次。本场比赛用过的卡牌和赛车手标记在赛后退场。
- English: Each racer can be used only once per game. Cards and racer tokens used in a race are removed from play after that race.

## 玩家人数与变体 / Player Counts and Variants

- 中文：第一版完整目标覆盖 2-6 名玩家。
- English: The complete first target supports 2-6 players.

- 中文：3-6 名玩家使用普通规则：每名玩家每场选择 1 名赛车手上场。
- English: With 3-6 players, use the standard rules: each player chooses 1 racer per race.

- 中文：2 名玩家使用官方 2 人变体：每名玩家招募 8 名赛车手；每场同时选择 2 名不同赛车手，因此赛道起始有 4 名赛车手。
- English: With 2 players, use the official 2 player variant: each player recruits 8 racers and simultaneously chooses 2 different racers per race, so 4 racers start on the track.

- 中文：3 名玩家双赛车手变体也要支持：每名玩家招募 8 名赛车手；每场同时选择 2 名不同赛车手，因此赛道起始有 6 名赛车手。
- English: Also support the 3 player double racer variant: each player recruits 8 racers and simultaneously chooses 2 different racers per race, so 6 racers start on the track.

- 中文：双赛车手变体中，一名玩家行动时依次使用自己的两名赛车手，每个赛车手都完整执行一个回合；“other racers”包括同一玩家控制的另一名赛车手。
- English: In double racer variants, when a player goes, they take turns with both racers one after the other, each as a complete turn. “Other racers” includes that player’s second racer.

## 招募与队伍 / Recruiting Your Team

- 中文：组队阶段采用蛇形选秀，不采用当前“每人随机发 4 张并秘密选 1 张”的演示流程。
- English: Recruiting uses a snake draft, not the current demo flow of randomly dealing 4 cards and secretly picking 1.

- 中文：普通 3-6 人规则中，每轮公开玩家人数 2 倍数量的赛车手牌：3 人公开 6 张，4 人公开 8 张，5 人公开 10 张，6 人公开 12 张。
- English: In the standard 3-6 player rules, each draft row reveals twice as many racer cards as players: 6 for 3 players, 8 for 4, 10 for 5, and 12 for 6.

- 中文：选秀前玩家点击掷骰决定起始玩家；最高点先选。如果平局，按规则比较下一高点；若所有人平局则重掷。
- English: Before drafting, players click to roll off for the starting drafter. Highest roll drafts first. If tied, use the next highest roll; if everyone ties, reroll.

- 中文：第一轮按顺时针每人选 1 名赛车手，到最后一名玩家后反向继续选，直到每人得到 2 名赛车手。
- English: In the first snake draft, players pick clockwise. After the last player picks, reverse direction until everyone has 2 racers.

- 中文：第二轮蛇形选秀从上一轮起始玩家左边的玩家开始；两轮后每名玩家共有 4 名赛车手，供四场比赛使用。
- English: The second snake draft starts with the player to the left of the first draft’s start player. After two snake drafts, every player has 4 racers for the four races.

- 中文：2 人变体中，先公开 8 张牌按 ABBAABBA 选完；再公开 8 张牌，以相反顺序再选一轮；最终每名玩家 8 名赛车手。
- English: In the 2 player variant, reveal 8 racers and draft in ABBAABBA order, then reveal 8 more and draft in reverse order. Each player ends with 8 racers.

- 中文：3 人双赛车手变体中，每次公开 6 张牌并正常蛇形选秀，共进行 4 次，每次轮换起始玩家；最终每名玩家 8 名赛车手。
- English: In the 3 player double racer variant, reveal 6 racers and snake draft normally. Do this 4 times, rotating who drafts first. Each player ends with 8 racers.

## 比赛流程 / Race Flow

- 中文：第一场比赛前，玩家点击掷骰决定先手顺序。线上版不由服务端静默代掷，也不由房主指定。
- English: Before the first race, players click to roll off for first turn order. The online version must not silently roll on the server or let the host assign it.

- 中文：每场比赛开始前，每名玩家从自己尚未使用的队伍中同时选择本场赛车手。
- English: Before each race, every player simultaneously chooses racers from their unused team.

- 中文：普通规则每名玩家选择 1 名赛车手；2 人和 3 人双赛车手变体每名玩家选择 2 名不同赛车手。
- English: Standard rules use 1 racer per player per race. The 2 player and 3 player double racer variants use 2 different racers per player per race.

- 中文：锁定前，选择对其他玩家保密；全部锁定后同时公开并开赛。
- English: Selections remain hidden until locked by everyone, then all selected racers are revealed simultaneously and the race starts.

- 中文：每个回合执行完整正式规则流程：主要移动、能力触发、反应、赛道格效果和回合推进。
- English: Each turn runs the full rules flow: main move, power triggers, reactions, racetrack space effects, and turn advancement.

- 中文：玩家回合结束后，下一名玩家按顺时针顺序行动。
- English: After a player finishes their turn, the next player goes in clockwise order.

- 中文：当第二名赛车手冲过终点线时，该场比赛立即结束。
- English: As soon as the 2nd place racer finishes, the race ends immediately.

- 中文：下一场比赛由上一场排名最靠后或最先被淘汰的赛车手所属玩家先走；双赛车手变体中，上一场得分较低的玩家先走，平局则掷骰。
- English: The next race starts with the player whose racer was farthest behind or first eliminated in the previous race. In double racer variants, the player with fewer points in the previous race goes first; if tied, roll off.

## 地图赛程 / Track Schedule

- 中文：本项目固定采用用户确认的 2+2 赛程：前两场 `Standard`，后两场 `WildWilds`。
- English: This project fixes the user-confirmed 2+2 schedule: the first two races use `Standard`, and the last two use `WildWilds`.

| 比赛 / Race | 地图 / Track |
| --- | --- |
| 第1场 / Race 1 | Standard |
| 第2场 / Race 2 | Standard |
| 第3场 / Race 3 | WildWilds |
| 第4场 / Race 4 | WildWilds |

- 中文：`Standard` 对应规则书中的 Mild Mile 基础赛道。
- English: `Standard` corresponds to the rulebook’s Mild Mile side.

- 中文：`WildWilds` 对应规则书中的 Wild Wilds 赛道，包含箭头、绊倒格和星星格。
- English: `WildWilds` corresponds to the rulebook’s Wild Wilds side, with arrows, trip spaces, and star spaces.

- 中文：规则书默认写法为每条赛道比赛两次，并允许开局前改变赛程；本项目按已确认的 Standard, Standard, WildWilds, WildWilds 固化。
- English: The rulebook races twice on each track and allows changing the schedule before the game; this project locks Standard, Standard, WildWilds, WildWilds.

## 四场比赛积分 / Four-Race Scoring

- 中文：第一名获得当前比赛最上方的金杯积分，第二名获得当前比赛最上方的银花结积分。
- English: The 1st place racer takes the top gold trophy chip, and the 2nd place racer takes the top silver rosette chip.

- 中文：四场比赛结束后，合计每位玩家所有已使用赛车手获得的积分，最高分获胜。
- English: After four races, add up all points earned by each player’s used racers; highest total wins.

| 比赛 / Race | 第一名：金杯 / 1st: Gold Trophy | 第二名：银花结 / 2nd: Silver Rosette |
| --- | ---: | ---: |
| 第1场 / Race 1 | 3 | 1 |
| 第2场 / Race 2 | 4 | 2 |
| 第3场 / Race 3 | 4 | 2 |
| 第4场 / Race 4 | 5 | 3 |

- 中文：设置积分筹码时，金杯从上到下为 3 -> 4 -> 4 -> 5，银花结从上到下为 1 -> 2 -> 2 -> 3。
- English: When stacking point chips, gold trophies from top to bottom are 3 -> 4 -> 4 -> 5, and silver rosettes from top to bottom are 1 -> 2 -> 2 -> 3.

- 中文：该逐场分值与旧版规则四场计分一致；新版规则书设置图显示第一场最上方为 3 分金杯和 1 分银花结。
- English: These race-by-race values match the older four-race scoring, and the newer setup diagram shows the top chips for race 1 as a 3-point gold trophy and a 1-point silver rosette.

## 规则术语 / Terms

- 中文：领先/落后：更靠近终点线即领先，更靠近起点即落后；同格时彼此既不领先也不落后。
- English: Ahead/Behind: a racer is ahead if stopped closer to the finish, behind if stopped closer to Start; racers sharing a space are neither ahead nor behind each other.

- 中文：独处：赛车手没有与其他赛车手共享其所在格。
- English: Alone: a racer is not sharing their space.

- 中文：最后一名：当前最靠近起点的赛车手，可以并列。
- English: Last place: the racer or racers currently closest to Start.

- 中文：领先者：当前最靠近终点线且尚未冲线的赛车手，可以并列。
- English: Lead: the racer or racers closest to the finish line, excluding racers that have already crossed it.

- 中文：主要移动：玩家回合中总会获得的动作，即掷骰并移动对应格数。
- English: Main move: the action a racer always gets on their turn, rolling a die and moving that many spaces.

- 中文：移动：赛车手因主要移动、能力或其他明确使用“move”的效果改变格子；移动 0 格不算移动。
- English: Move: changing spaces via a main move, power, or any effect that says “move”; moving 0 does not count as moving.

- 中文：经过：一次移动开始时在某赛车手后方，并在同一次移动结束时到达其前方。
- English: Passing: starting a move behind another racer and ending the same move ahead of them.

- 中文：共享一格：两名赛车手当前都停在同一格；移动或传送过程中的临时重叠不算。
- English: Sharing a space: both racers are currently stopped on the same space; temporary overlap during moving or warping does not count.

- 中文：格子：从起点格到终点线的方格；起点格也算一格，终点线之后不算。
- English: Space: the squares from Start through the finish line; Start counts as a space, and anything past the finish line does not.

- 中文：停在一格上：完成移动进入该格后，或通过传送等方式到达该格后，视为停在该格。
- English: Stopping on a space: a racer is stopped on a space after finishing movement onto it or arriving there by another means such as warping.

- 中文：绊倒：被绊倒的赛车手跳过下一次主要移动，但能力仍可触发，也仍可通过其他方式移动；绊倒不会提前结束当前移动。
- English: Trip: a tripped racer skips their next main move, but their powers can still trigger and they can still move in other ways; tripping does not end the current move early.

- 中文：传送：将赛车手放到新格子上，但不算移动，不触发移动、经过等相关效果。
- English: Warp: place the racer on the new space, but do not count it as moving for movement triggers, passing racers, and similar effects.

## 能力与触发 / Powers and Triggers

- 中文：如果某个能力写明“can / 可以”，它是可选能力；其他能力强制生效。
- English: If a power says the racer “can” use it, it is optional; all other powers are mandatory.

- 中文：多个能力同时触发时，顺序为：赛道格 -> 当前玩家 -> 其他玩家按顺时针顺序。
- English: If multiple powers need to resolve at the same time, resolve them in this order: racetrack spaces -> current player -> other players going clockwise.

- 中文：因任何原因重掷时，先前掷出的数字视为从未发生；但重掷动作本身仍可触发相关能力。
- English: If a die is rerolled for any reason, treat the previous number as if it never happened; the reroll action itself can still trigger relevant powers.

- 中文：起点格是一个格子。
- English: The Start space is a space.

- 中文：与一起停在一格相关的能力，在赛车手同时到达时仍会触发。
- English: Powers related to stopping on a space together still trigger if racers arrive at the same time.

- 中文：在特定时间发生的能力，例如“在我的主要移动之前”，每回合只发生一次。
- English: Powers that happen at a specific time, such as “Before my main move,” only happen once per turn.

- 中文：赛车手获胜或以其他方式离开比赛后，其能力失效，除非另有说明。
- English: Racer powers deactivate after they win or otherwise leave a race, unless otherwise stated.

- 中文：任何“可以重掷”的效果只适用于最近一次掷出的骰子。
- English: Any “can reroll” effect applies only to the most recent die rolled.

- 中文：如果发生无限循环，按发生顺序完整执行一次循环，然后结束该循环；不会导致无人能继续操作。
- English: If an infinite loop occurs, complete the loop once in the order it happens, then end that loop.

- 中文：如果能力循环导致无人可以完成比赛，该场比赛结束，剩余名次积分无人获得。
- English: If powers create a loop where no one can finish, the race ends and no one receives the remaining points.

## 狂野赛道格 / Wild Wilds Track

- 中文：箭头：停在箭头格时，按箭头方向移动指定格数。这是独立移动，不属于主要移动。
- English: Arrows: when stopped on an arrow space, move the shown number of spaces in that direction. This is a separate move and never part of the main move.

- 中文：绊倒格：停在写有 TRIP 的格子上时，被绊倒。
- English: Trip spaces: when stopped on a space that says TRIP, the racer trips.

- 中文：星星：停在星星格上时，获得 1 分铜色积分。
- English: Stars: when stopped on a star space, take a bronze 1 point chip.

## 当前实现差距 / Current Implementation Gap

- 中文：截至本文档写入时，现有代码仍包含旧的单场演示流程特征：每人随机 4 张、秘密选 1 张、只跑一场。
- English: As of this document, the code still contains old single-race demo assumptions: randomly deal 4 cards per player, secretly pick 1, and run only one race.

- 中文：后续实现应以本文档为目标，移除演示假设，并把协议、状态机、前端流程和测试全部对齐到四场正式规则。
- English: Future implementation should use this document as the target, remove demo assumptions, and align the protocol, state machine, frontend flow, and tests with the four-race official rules.
