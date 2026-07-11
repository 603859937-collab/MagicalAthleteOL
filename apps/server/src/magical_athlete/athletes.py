from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AthleteCard:
    id: str
    name: str
    name_zh: str
    ability_title_zh: str
    ability_summary: str
    engine_name: str

    def public_data(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.name,
            "nameZh": self.name_zh,
            "abilityTitleZh": self.ability_title_zh,
            "abilitySummary": self.ability_summary,
        }


def card(
    athlete_id: str,
    name: str,
    name_zh: str,
    ability_title_zh: str,
    ability_summary: str,
    engine_name: str | None = None,
) -> AthleteCard:
    return AthleteCard(
        athlete_id, name, name_zh, ability_title_zh, ability_summary,
        engine_name or name.replace(" ", ""),
    )


ATHLETE_CATALOG = (
    card("alchemist", "Alchemist", "炼金术士", "点石成金", "主要移动掷出 1 或 2 时，可以改为移动 4。"),
    card("baba_yaga", "Baba Yaga", "芭芭雅嘎", "撒腿就跑", "与其他赛车手停在同一格时，会使对方绊倒。", "BabaYaga"),
    card("banana", "Banana", "香蕉", "滑倒吧", "其他赛车手经过香蕉时会被绊倒。"),
    card("blimp", "Blimp", "飞艇", "吹起来", "第二个弯道前主要移动 +2，之后主要移动 -1。"),
    card("centaur", "Centaur", "半人马", "蹄击", "经过其他赛车手时，将其向后移动 2 格。"),
    card("cheerleader", "Cheerleader", "啦啦队长", "加油加油", "主要移动前可让最后一名移动 2，自己再移动 1。"),
    card("coach", "Coach", "教练", "冲刺训练", "同格赛车手的主要移动 +1，包括自己。"),
    card("copycat", "Copycat", "模仿猫", "照猫画虎", "持续复制当前领先赛车手的能力。"),
    card("dicemonger", "Dicemonger", "骰商", "骰子交易", "所有人每回合可重掷一次；别人重掷时自己移动 1。"),
    card("duelist", "Duelist", "决斗家", "决斗", "同格时可决斗，点数较高者移动 2，平局自己获胜。"),
    card("egg", "Egg", "蛋", "大洗牌", "比赛前抽取一名未上场赛车手并复制其能力。"),
    card("flip_flop", "Flip Flop", "人字拖", "人字互换", "通过传送交换位置，扰乱赛场顺序。", "FlipFlop"),
    card("genius", "Genius", "天才", "神机妙算", "预测主要移动点数，猜中可追加一个回合。"),
    card("gunk", "Gunk", "黏液怪", "黏住他们", "与其同格会降低赛车手的移动量。"),
    card("hare", "Hare", "野兔", "骄傲自满", "领先时速度惊人，但过度自信会付出代价。"),
    card("heckler", "Heckler", "起哄者", "幸灾乐祸", "赛车手结束回合时离起点不远，自己移动 2。"),
    card("huge_baby", "Huge Baby", "巨婴", "真是巨大", "其他赛车手无法停在其所在格，会被推到后方。", "HugeBaby"),
    card("hypnotist", "Hypnotist", "催眠师", "嘘……", "用催眠将其他赛车手传送到新的位置。"),
    card("inchworm", "Inchworm", "尺蠖", "蠕动", "以稳定的小步移动持续向前。"),
    card("lackey", "Lackey", "跟班", "遵命，老爷", "对特定骰点忠诚地触发额外效果。"),
    card("leaptoad", "Leaptoad", "跳跳蛙", "跳蛙", "跳过其他赛车手并获得额外移动。"),
    card("legs", "Legs", "长腿", "慢跑", "主要移动使用两颗骰子并取更有利的结果。"),
    card("lovable_loser", "Lovable Loser", "可爱输家", "好可怜", "落后时获得额外动力与积分机会。", "LovableLoser"),
    card("magician", "Magician", "魔术师", "消失", "操纵最近一次骰子重掷，改变关键结果。"),
    card("mastermind", "Mastermind", "幕后主脑", "万事通", "预测其他赛车手的行动并从中获益。"),
    card("mouth", "Mouth", "大嘴", "大口吞下", "吞下同格赛车手并随移动带走他们。"),
    card("party_animal", "Party Animal", "派对动物", "万人迷", "和其他赛车手聚在一起时获得额外移动。", "PartyAnimal"),
    card("romantic", "Romantic", "浪漫主义者", "啊，爱情", "追随心仪的赛车手并一同前进。"),
    card("rocket_scientist", "Rocket Scientist", "火箭科学家", "轰隆升空", "利用火箭效果获得爆发式推进。", "RocketScientist"),
    card("scoocher", "Scoocher", "挪步者", "挪一挪", "其他赛车手移动时会触发连续的小步前进。"),
    card("sisyphus", "Sisyphus", "西西弗斯", "继续滚", "反复积蓄力量，并从艰难处境中获得积分。"),
    card("skipper", "Skipper", "抢跑者", "老水手", "在特定条件下跳过常规顺序，取得额外回合。"),
    card("stickler", "Stickler", "较真者", "严格来说", "必须以严格点数冲线，但能控制终点判定。"),
    card("suckerfish", "Suckerfish", "吸盘鱼", "吸住不放", "依附并跟随经过自己的赛车手前进。"),
    card("third_wheel", "Third Wheel", "电灯泡", "顺势加入", "两名赛车手互动时会加入其中。", "ThirdWheel"),
    card("twin", "Twin", "双胞胎", "双倍下注", "复制另一名赛车手的行动或能力效果。"),
)

ATHLETE_BY_ID = {athlete.id: athlete for athlete in ATHLETE_CATALOG}
