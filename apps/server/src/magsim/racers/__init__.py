from __future__ import annotations

import functools
import json
from importlib.resources import files
from typing import TYPE_CHECKING

from magsim.core.abilities import Ability
from magsim.core.modifiers import RacerModifier
from magsim.core.registry import RACER_ABILITIES
from magsim.core.types import RacerName, RacerStat

if TYPE_CHECKING:
    from collections.abc import Callable

    from magsim.core.types import AbilityName

INTERNAL_STATS_PATH = files("magsim.data").joinpath(
    "racer_stats.json",
)


@functools.cache
def _import_modules() -> None:
    # Keep imports explicit so Workers can bundle them without scanning Pyodide's filesystem.
    from magsim.racers import (  # noqa: F401
        alchemist,
        baba_yaga,
        banana,
        blimp,
        centaur,
        cheerleader,
        coach,
        copycat,
        dicemonger,
        duelist,
        egg,
        flip_flop,
        genius,
        gunk,
        hare,
        heckler,
        huge_baby,
        hypnotist,
        inchworm,
        lackey,
        leaptoad,
        legs,
        lovable_loser,
        magician,
        mastermind,
        mouth,
        party_animal,
        rocket_scientist,
        romantic,
        scoocher,
        sisyphus,
        skipper,
        stickler,
        suckerfish,
        third_wheel,
        twin,
    )


@functools.cache
def get_ability_classes() -> dict[AbilityName, type[Ability]]:
    _import_modules()
    return {cls.name: cls for cls in Ability.__subclasses__()}


@functools.cache
def get_modifier_classes() -> dict[AbilityName | str, type[RacerModifier]]:
    return {cls.name: cls for cls in RacerModifier.__subclasses__()}


@functools.cache
def get_all_racer_stats(
    log_fn: Callable[[str], None] = print,
) -> dict[RacerName, RacerStat]:
    try:
        # We read the text content directly from the package resource
        json_content = INTERNAL_STATS_PATH.read_text(encoding="utf-8")
        data = json.loads(json_content)

        # Convert list of dicts to Dict[Name, RacerStat]
        return {d["racer_name"]: RacerStat(**d) for d in data}

    except (FileNotFoundError, json.JSONDecodeError) as e:
        log_fn(f"⚠️  Could not load internal racer stats: {e}")
        log_fn("    Falling back to default (zero) stats.")

        # Fallback: Create empty stats for every known racer
        return {racer_name: RacerStat(racer_name) for racer_name in RACER_ABILITIES}
