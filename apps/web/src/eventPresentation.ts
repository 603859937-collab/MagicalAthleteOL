import type { GameEvent, PlayerState, RoomSnapshot } from "./protocol";
import { abilityTitle, decisionOptionLabel } from "./decisionPresentation";

export type Participant = { playerId?: string; athleteId?: string; name: string; owner: string };
export type ActionMoment = { source: Participant; target: Participant; cause: string; effect: string; from?: number; to?: number };

function participant(players: PlayerState[], playerId?: string, athleteId?: string): Participant {
  const owner = players.find((p) => p.id === playerId);
  const card = owner?.activeRacers.find((r) => r.id === athleteId) ?? owner?.team.find((r) => r.id === athleteId);
  return { playerId, athleteId, name: card?.nameZh ?? "赛车手", owner: owner?.name ?? "" };
}

export function isRedundantAbilityEvent(event: GameEvent, events: GameEvent[]): boolean {
  return event.type === "ABILITY_TRIGGERED" && events.some((effect) =>
    ["RACER_MOVED", "RACER_WARPED", "RACER_TRIPPED"].includes(effect.type)
    && (effect.source === event.abilityName || event.abilityName === "SuckerfishTarget" && effect.source === "SuckerfishRide")
    && effect.sourcePlayerId === event.sourcePlayerId && effect.sourceAthleteId === event.sourceAthleteId
    && (!event.athleteId || effect.athleteId === event.athleteId && effect.playerId === event.playerId));
}

function athleteName(players: PlayerState[], playerId?: string, athleteId?: string): string {
  const owner = players.find((item) => item.id === playerId);
  const card = owner?.activeRacers.find((item) => item.id === athleteId)
    ?? owner?.team.find((item) => item.id === athleteId);
  return card?.nameZh ?? "赛车手";
}

// One complete sentence per recorded event, so the feed never needs to drop detail.
// `events` holds the siblings from the same update so repeated ability notices collapse.
export function eventText(event: GameEvent, players: PlayerState[], events: GameEvent[] = []): string {
  if (event.type === "ABILITY_TRIGGERED" && isRedundantAbilityEvent(event, events)) return "";
  const player = players.find((item) => item.id === event.playerId);
  const who = player?.name ?? "玩家";
  if (event.type === "START_DICE_ROLLED") return `${who} 掷出 ${event.values?.join(" / ")}`;
  if (event.type === "ROLL_OFF_TIED") return "最高点相同，平局玩家重新掷骰";
  if (event.type === "ATHLETE_DRAFTED") return `${who} 完成一次招募`;
  if (event.type === "RACERS_LOCKED") return `${who} 已锁定阵容`;
  if (event.type === "DICE_ROLLED") return `${who} 掷出 ${event.value}`;
  if (event.type === "DIE_ROLLED") return `${who} 掷出第 ${(event.throwIndex ?? 0) + 1} 颗骰子：${event.value}`;
  if (event.type === "ABILITY_DICE_ROLLED") return `${who} 在决斗中掷出 ${event.value}`;
  if (event.type === "ABILITY_ROLL_RESOLVED") {
    const winner = players.find((item) => item.id === event.winnerPlayerId);
    return `${winner?.name ?? "玩家"} 赢得决斗`;
  }
  const moment = actionMoment(event, players, events);
  if (moment) return `${moment.cause} → ${moment.target.owner}的${moment.target.name}：${moment.effect}`;
  if (event.type === "ROLL_OFF_WON") return `${who} 获得先手`;
  if (event.type === "DECISION_REQUIRED") {
    return `${who} 的${event.athleteName ?? athleteName(players, event.playerId, event.athleteId)}使用「${abilityTitle(event.abilityName)}」，等待选择`;
  }
  if (event.type === "DECISION_RESOLVED") {
    const chosen = event.optionLabel ? decisionOptionLabel(event.optionLabel) : "";
    return `${who} 的「${abilityTitle(event.abilityName)}」选择：${chosen || "已提交"}`;
  }
  if (event.type === "DECISION_TIMED_OUT") return `${who} 超时未选，「${abilityTitle(event.abilityName)}」由系统自动决定`;
  if (event.type === "TRIP_RECOVERED") {
    return `${who} 的${athleteName(players, event.playerId, event.athleteId)}从绊倒中恢复，跳过本次移动`;
  }
  if (event.type === "RACER_ELIMINATED") {
    return `${who} 的${athleteName(players, event.playerId, event.athleteId)}被淘汰`;
  }
  if (event.type === "RACER_FINISHED") {
    return `${who} 的${athleteName(players, event.playerId, event.athleteId)}第 ${event.finishPosition} 名冲线`;
  }
  if (event.type === "RACE_FINISHED") return `第 ${event.raceNumber} 场比赛结束`;
  if (event.type === "PLAYER_JOINED") return `${who} 加入房间`;
  if (event.type === "PLAYER_LEFT") return `${event.playerName ?? "玩家"} ${event.reason === "KICKED" ? "被房主移出房间" : "退出房间"}`;
  if (event.type === "PLAYER_DISCONNECTED") return `${who} 暂时离线`;
  return "";
}

export function actionMoment(event: GameEvent, players: PlayerState[], events: GameEvent[] = []): ActionMoment | null {
  if (!["ABILITY_TRIGGERED", "RACER_MOVED", "RACER_WARPED", "RACER_TRIPPED"].includes(event.type)) return null;
  const source = participant(players, event.sourcePlayerId, event.sourceAthleteId);
  if (event.sourceAthleteName) source.name = event.sourceAthleteName;
  const target = participant(players, event.playerId ?? event.sourcePlayerId, event.athleteId ?? event.sourceAthleteId);
  const self = source.playerId === target.playerId && source.athleteId === target.athleteId;
  const roll = events.find((item) => item.type === "DICE_ROLLED" && item.playerId === event.playerId && item.athleteId === event.athleteId);
  const key = event.abilityName ?? event.source;
  const followed = event.triggerAthleteId ? participant(players, event.triggerPlayerId, event.triggerAthleteId) : null;
  if (followed && event.triggerAthleteName) followed.name = event.triggerAthleteName;
  const causes: Record<string, string> = {
    CentaurTrample: `${source.name}经过${target.name}`,
    BananaTrip: `${target.name}经过${source.name}`,
    BabaYagaTrip: `${target.name}与${source.name}停在同一格`,
    CoachBoost: self ? `${source.name}本次为自己加速` : `${target.name}在${source.name}所在格开始移动`,
    LongLegs: `${target.name}本次使用两颗骰子${roll?.values ? `（${roll.values.join(" / ")}）` : ""}`,
    HugeBabyBlocker: `${target.name}即将停在${source.name}所在格`,
    HugeBabyPush: `${source.name}落在${target.name}所在格`,
    LackeyLoyalty: "其他赛车手本次掷出了 6",
    InchwormCreep: "其他赛车手本次掷出了 1",
    ScoochStep: "另一名赛车手刚刚触发了技能",
    SisyphusCurse: `${source.name}本次掷出了 6`,
    RocketScientistBoost: `${source.name}本次选择了火箭加速`,
    HareHubris: `${source.name}在回合开始时独自领先`,
    HareSpeed: `${source.name}本次进行主要移动`,
    LovableLoserBonus: `${source.name}在回合开始时独自垫底`,
    LeaptoadJump: `${source.name}本次移动遇到有赛车手的格子`,
    HypnotistWarp: `${source.name}本回合选中了${target.name}`,
    FlipFlopSwap: `${source.name}本回合选择交换位置`,
    GunkSlimeModifier: `${source.name}在场，${target.name}本次移动受到减速`,
    HecklerHeckle: "本回合结束位置距回合起点不超过 1 格",
    CheerleaderSupport: `${source.name}本回合选择为末位加油`,
    PartyPull: `${source.name}开始回合，拉近其他赛车手`,
    PartySelfBoost: `${source.name}本次移动前与其他赛车手同格`,
    SuckerfishTarget: followed ? `${target.name}跟随${followed.name}` : `${source.name}本次跟随已锁定落点`,
    MoveDeltaTile: `${target.name}落在第 ${event.from} 格，触发移动格效果`,
    TripTile: `${target.name}落在绊倒格`,
    SuckerfishRide: followed ? `${followed.name}从同格离开，${target.name}选择跟随` : `同格赛车手刚刚移动，${source.name}选择跟随`,
    ThirdWheelJoin: `${source.name}选择加入恰好有两名赛车手的格子`,
    SkipperTurn: "本次掷出了 1",
    DuelistDuel: `${target.name}赢得本次决斗`,
  };
  const isNormal = key === "System" || !key;
  if (isNormal || !source.athleteId) {
    source.athleteId = undefined;
    source.playerId = undefined;
    source.name = isNormal ? "骰子" : key === "Board" || key?.endsWith("Tile") ? "赛道格效果" : "技能效果";
    source.owner = "";
  }
  const distance = typeof event.from === "number" && typeof event.to === "number" ? event.to - event.from : undefined;
  let effect = "本次技能已触发";
  if (event.type === "RACER_TRIPPED") effect = "绊倒";
  else if (distance !== undefined) effect = event.type === "RACER_WARPED"
    ? event.movementKind === "SWAP" ? "交换位置" : `传送至第 ${event.to} 格`
    : distance === 0 ? "位置不变" : `${distance > 0 ? "前进" : "后退"} ${Math.abs(distance)} 格`;
  else if (key === "SuckerfishTarget") effect = "按跟随目标确定落点";
  else if (key === "DuelistDuel") effect = "胜者获得本次额外移动";
  else if (key === "LongLegs") effect = roll?.value !== undefined ? `选用 ${roll.value} 点` : "选定本次移动骰点";
  else if (key === "HareHubris") effect = "跳过本次主要移动";
  else if (key === "HareSpeed") effect = "本次移动 +2";
  else if (key === "LovableLoserBonus") effect = "得分 +1";
  else if (key === "LeaptoadJump") effect = "跳过占用格，不消耗步数";
  else if (key === "GunkSlimeModifier") effect = "本次移动 -1";
  else if (key === "SkipperTurn") effect = "获得下一个回合";
  else if (key === "CoachBoost") effect = "本次移动 +1";
  else if (key === "HugeBabyBlocker") effect = "落点向后调整 1 格";
  else if (event.movementDistance) effect = `移动调整 ${event.movementDistance > 0 ? "+" : ""}${event.movementDistance}`;
  return { source: key?.startsWith("Suckerfish") && followed ? followed : source, target, cause: causes[key ?? ""] ?? (isNormal ? "执行本次掷骰移动" : `${source.name}对${target.name}触发效果`), effect, from: event.from, to: event.to };
}

// Keep the completed round visible even though the server has already cleared its dice.
export function rollOffPresentation(before: RoomSnapshot, after: RoomSnapshot, events: GameEvent[]) {
  const display = structuredClone(before);
  for (const event of events) {
    const player = display.game.players.find((p) => p.id === event.playerId);
    if (event.type === "START_DICE_ROLLED" && player) player.rollValues = event.values ?? null;
  }
  const winner = events.find((e) => e.type === "ROLL_OFF_WON");
  const tie = events.find((e) => e.type === "ROLL_OFF_TIED");
  const name = (id?: string) => after.game.players.find((p) => p.id === id)?.name ?? "玩家";
  const outcome = winner ? `${name(winner.playerId)} 获得${before.game.phase === "DRAFT_ROLL" ? "首位招募权" : "本场先手"}`
    : tie ? `${tie.playerIds?.map(name).join("、")} 点数相同，需要重掷` : "";
  return { display, outcome, winnerId: winner?.playerId };
}
