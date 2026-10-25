const MS_PER_SECOND = 1_000

/** Whole seconds left until `untilMs`, rounded up and never below zero. */
export function formatCountdown(untilMs: number, nowMs: number): string {
  return String(Math.max(0, Math.ceil((untilMs - nowMs) / MS_PER_SECOND)))
}
