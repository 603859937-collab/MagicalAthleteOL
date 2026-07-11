from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AthleteCard:
    id: str
    name: str
    name_zh: str
    ability_summary: str

    def public_data(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.name,
            "nameZh": self.name_zh,
            "abilitySummary": self.ability_summary,
        }


ATHLETE_CATALOG = (
    AthleteCard("alchemist", "Alchemist", "炼金术士", "掷骰后可以改变骰子的结果。"),
    AthleteCard("banana", "Banana", "香蕉", "其他选手踩到香蕉时可能被绊倒。"),
    AthleteCard("blimp", "Blimp", "飞艇", "以独特的方式在赛道上缓慢而稳定地移动。"),
    AthleteCard("centaur", "Centaur", "半人马", "善于用持续的高速移动拉开距离。"),
    AthleteCard("cheerleader", "Cheerleader", "啦啦队长", "为其他选手提供额外的移动助力。"),
    AthleteCard("coach", "Coach", "教练", "可以调整场上选手的位置与节奏。"),
    AthleteCard("egg", "Egg", "蛋", "比赛开始时孵化并获得另一名角色的能力。"),
    AthleteCard("hare", "Hare", "野兔", "领先时速度惊人，但也可能停下来休息。"),
    AthleteCard("huge_baby", "Huge Baby", "巨婴", "庞大的身体会阻挡试图经过的选手。"),
    AthleteCard("inchworm", "Inchworm", "尺蠖", "以特殊的小步幅持续向终点推进。"),
    AthleteCard("legs", "Legs", "长腿", "凭借长腿获得更强的基础移动能力。"),
    AthleteCard("magician", "Magician", "魔术师", "可以操纵重掷，改变关键回合的结果。"),
    AthleteCard("party_animal", "Party Animal", "派对动物", "与其他选手聚在一起时会获得额外动力。"),
    AthleteCard("rocket_scientist", "Rocket Scientist", "火箭科学家", "利用火箭效果实现爆发式前进。"),
    AthleteCard("sisyphus", "Sisyphus", "西西弗斯", "会反复积蓄力量，再迎来强力推进。"),
    AthleteCard("skipper", "Skipper", "跳跃者", "可以跳过部分赛道位置和阻碍。"),
)
