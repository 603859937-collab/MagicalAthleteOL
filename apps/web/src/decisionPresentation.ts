import type { GameEvent, PendingDecision } from "./protocol";

// Labels mirror the server athlete catalog; wire identifiers remain unchanged.
const racerNames: Record<string, string> = {
  "Alchemist": "炼金术士",
  "BabaYaga": "芭芭雅嘎",
  "Banana": "香蕉",
  "Blimp": "飞艇",
  "Centaur": "半人马",
  "Cheerleader": "啦啦队长",
  "Coach": "教练",
  "Copycat": "模仿猫",
  "Dicemonger": "骰商",
  "Duelist": "决斗家",
  "Egg": "蛋",
  "FlipFlop": "人字拖",
  "Genius": "天才",
  "Gunk": "黏液怪",
  "Hare": "野兔",
  "Heckler": "起哄者",
  "HugeBaby": "巨婴",
  "Hypnotist": "催眠师",
  "Inchworm": "尺蠖",
  "Lackey": "跟班",
  "Leaptoad": "跳跳蛙",
  "Legs": "长腿",
  "LovableLoser": "可爱输家",
  "Magician": "魔术师",
  "Mastermind": "幕后主脑",
  "Mouth": "大嘴",
  "PartyAnimal": "派对动物",
  "Romantic": "浪漫主义者",
  "RocketScientist": "火箭科学家",
  "Scoocher": "挪步者",
  "Sisyphus": "西西弗斯",
  "Skipper": "抢跑者",
  "Stickler": "较真者",
  "Suckerfish": "吸盘鱼",
  "ThirdWheel": "电灯泡",
  "Twin": "双胞胎"
};

const abilityNames: Record<string, string> = {
  "AlchemistAlchemy": "点石成金",
  "BabaYagaTrip": "撒腿就跑",
  "BananaTrip": "滑倒吧",
  "BlimpModifierManager": "吹起来",
  "CentaurTrample": "蹄击",
  "CheerleaderSupport": "加油加油",
  "CoachAura": "冲刺训练",
  "CopyLead": "照猫画虎",
  "DicemongerRerollManager": "骰子交易",
  "DicemongerDeal": "骰子交易",
  "DuelistDuel": "决斗",
  "EggCopy": "大洗牌",
  "FlipFlopSwap": "人字互换",
  "GeniusPrediction": "神机妙算",
  "GunkSlime": "黏住他们",
  "HareHubris": "骄傲自满",
  "HecklerHeckle": "幸灾乐祸",
  "HugeBabyPush": "真是巨大",
  "HypnotistWarp": "嘘……",
  "InchwormCreep": "蠕动",
  "LackeyLoyalty": "遵命，老爷",
  "LeaptoadJumpManager": "跳蛙",
  "LongLegs": "慢跑",
  "LovableLoserBonus": "好可怜",
  "MagicalReroll": "消失",
  "MastermindPredict": "万事通",
  "MouthSwallow": "大口吞下",
  "PartyBoostManager": "万人迷",
  "PartyPull": "万人迷",
  "RomanticMove": "啊，爱情",
  "RocketScientistBoost": "轰隆升空",
  "ScoochStep": "挪一挪",
  "SisyphusCurse": "继续滚",
  "SkipperTurn": "老水手",
  "SticklerStrictFinishManager": "严格来说",
  "SuckerfishRide": "吸住不放",
  "ThirdWheelJoin": "顺势加入",
  "TwinCopy": "双倍下注"
};

export function decisionTitle(decision: PendingDecision): string {
  return abilityNames[decision.abilityName] ?? `${decision.athleteName}的技能`;
}

export type DecisionOutcome = { optionId: string | null; automatic: boolean; playerId: string };

// Every client keeps showing the closed dialog once its choice lands, so the table
// can see which button the deciding player picked.
export function decisionResolution(
  decision: PendingDecision | null | undefined,
  events: GameEvent[],
): DecisionOutcome | null {
  if (!decision) return null;
  const resolved = events.find((event) =>
    (event.type === "DECISION_RESOLVED" || event.type === "DECISION_TIMED_OUT")
    && event.decisionId === decision.id);
  if (!resolved) return null;
  return {
    optionId: resolved.optionId || null,
    automatic: Boolean(resolved.automatic) || resolved.type === "DECISION_TIMED_OUT",
    playerId: resolved.playerId ?? decision.playerId,
  };
}

export function abilityTitle(abilityName?: string): string {
  if (!abilityName) return "技能";
  return abilityNames[abilityName] ?? abilityName;
}

export function decisionOptionLabel(label: string): string {
  return racerNames[label] ?? label;
}

export function decisionPrompt(decision: PendingDecision): string {
  const prompts: Record<string, string> = {
    GeniusPrediction: "预测接下来会掷出的骰点；猜中可获得额外回合。",
    MastermindPredict: "预测哪名其他赛车手会第一个冲线。",
    FlipFlopSwap: "选择一名角色交换位置；使用后将跳过本回合的正常移动。也可以不使用。",
    HypnotistWarp: "选择一名其他角色，将其传送到你所在的格子；也可以不使用。",
    DuelistDuel: "选择同格的一名角色决斗；双方掷骰，胜者前进 2 格，平局由发起者获胜。也可以不使用。",
    ThirdWheelJoin: "选择一个恰有两名角色的格子并传送过去；也可以不使用。",
    CopyLead: "领先者并列，选择其中一名角色复制能力。",
    CheerleaderSupport: "是否让所有并列最后的角色前进 2 格，再让自己前进 1 格？",
    AlchemistAlchemy: "是否把本次基础移动值改为 4？",
    RocketScientistBoost: "是否额外增加本次骰点的移动距离？使用后自己会绊倒。",
    DicemongerDeal: "是否重掷？借用其他角色的骰商能力时，对方会前进 1 格。",
    MagicalReroll: "是否重掷？每回合最多使用两次。",
  };
  if (decision.abilityName === "SuckerfishRide" && decision.effectPreview) {
    const preview = decision.effectPreview;
    return `是否跟随${preview.athleteName}，从第 ${preview.from} 格移动到第 ${preview.to} 格？`;
  }
  if (prompts[decision.abilityName]) return prompts[decision.abilityName];
  if (decision.choiceType === "DIE") return "选择本次使用的骰点";
  if (decision.choiceType === "TILE") return "选择本次传送到的格子";
  if (decision.abilityName === "TwinCopy" || decision.abilityName === "EggCopy") return "选择本次复制的角色能力";
  if (decision.choiceType === "RACER") return "选择本次技能的目标角色";
  if (decision.choiceType === "BOOLEAN") return `本次是否使用「${decisionTitle(decision)}」？`;
  return decision.prompt.split(decision.abilityName).join(decisionTitle(decision));
}
