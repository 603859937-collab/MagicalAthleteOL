import type { DiceRollResult, GameEvent, RoomSnapshot } from "./protocol";

type RollUpdate = RoomSnapshot & { events: GameEvent[]; rollResults?: DiceRollResult[] };

function isDieValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

export function latestAuthoritativeRollValue(snapshot: RoomSnapshot): number | null {
  const previewValue = snapshot.game.pendingDecision?.rollPreview?.value;
  if (isDieValue(previewValue)) return previewValue;

  for (let index = snapshot.game.raceLog.length - 1; index >= 0; index -= 1) {
    const event = snapshot.game.raceLog[index];
    if (event.type === "DICE_ROLLED" && isDieValue(event.value)) return event.value;
  }
  return null;
}

export function collectUnseenRollValues(message: RollUpdate, shownRolls: Set<string>): number[] {
  if (message.rollResults) {
    return message.rollResults.flatMap((result) => {
      if (shownRolls.has(result.id)) return [];
      shownRolls.add(result.id);
      return result.values;
    });
  }

  const raceKey = message.game.raceNumber;
  const newlyShown = new Set<string>();
  const values = message.events.flatMap((event, index) => {
    if (event.type !== "DICE_ROLLED" || typeof event.value !== "number") return [];
    const key = typeof event.rollSerial === "number"
      ? `${raceKey}:${event.rollSerial}`
      : `${raceKey}:${message.revision}:event:${index}`;
    if (shownRolls.has(key) || newlyShown.has(key)) return [];
    newlyShown.add(key);
    return [event.value];
  });

  const preview = message.game.pendingDecision?.rollPreview;
  if (preview) {
    const key = `${raceKey}:${preview.rollSerial}`;
    if (!shownRolls.has(key) && !newlyShown.has(key)) {
      newlyShown.add(key);
      values.push(preview.value);
    }
  }

  newlyShown.forEach((key) => shownRolls.add(key));
  return values;
}
