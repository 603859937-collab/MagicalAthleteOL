export interface DiceLifecycle {
  targetValue: number | null;
  restingValue: number;
  appliedResetKey: number | null;
}

export function createDiceLifecycle(targetValue: number | null, restingValue: number): DiceLifecycle {
  return { targetValue, restingValue, appliedResetKey: null };
}

export function syncDiceLifecycle(
  lifecycle: DiceLifecycle,
  targetValue: number | null,
  restingValue: number,
): void {
  lifecycle.targetValue = targetValue;
  lifecycle.restingValue = restingValue;
}

export function takeDiceResetValue(lifecycle: DiceLifecycle, resetKey: number): number | undefined {
  if (lifecycle.appliedResetKey === resetKey) return undefined;
  lifecycle.appliedResetKey = resetKey;
  return lifecycle.restingValue;
}
