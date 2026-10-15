import { MS_PER_MINUTE } from '@/core/utils/time'

// The loop caps, named once. The config resolver applies them when `[loop]` omits a key, and the
// failure hints fall back to them when a halt carries no run of its own to read.
export const DEFAULT_MAX_TURNS = 40
export const DEFAULT_MAX_TOOL_CALLS = 120
export const DEFAULT_MAX_DURATION_MS = 900_000

/** Caps a run reports back so a hint can name what was in force, not what ships by default. */
interface HintLimits {
  readonly maxTurns: number
  readonly maxToolCalls: number
  readonly maxDurationMs: number
}

// Every limit hint names its cap, so all three params are always supplied: `t` leaves an unfilled
// placeholder in the rendered string. A halt raised before a run exists falls back to the defaults.
export function failureHintParams(
  brand: string,
  limits?: HintLimits
): Record<string, string | number> {
  return {
    brand,
    maxTurns: limits?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxToolCalls: limits?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    maxDurationMin: Math.round((limits?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS) / MS_PER_MINUTE),
  }
}
