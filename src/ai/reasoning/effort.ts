const EFFORT_ORDER = ['off', 'low', 'medium', 'high'] as const

export type ReasoningEffortLevel = (typeof EFFORT_ORDER)[number]

export interface ModelReasoningCapability {
  readonly efforts: readonly ReasoningEffortLevel[]
}

/** Pure, sync: pi's clampThinkingLevel, adapted to the 4-level enum. Search up, then down.
 *  `floor` is the lowest level the caller accepts: without it, a capability advertising only `off`
 *  clamps a mandatory request back to `off` and the caller re-asks for `low`, forever. */
export function clampReasoningEffort(
  requested: ReasoningEffortLevel,
  capability: ModelReasoningCapability,
  options?: { readonly floor?: ReasoningEffortLevel }
): ReasoningEffortLevel {
  const floorIndex = EFFORT_ORDER.indexOf(options?.floor ?? 'off')
  const allowed = capability.efforts.filter((level) => EFFORT_ORDER.indexOf(level) >= floorIndex)

  if (allowed.includes(requested)) {
    return requested
  }

  const start = Math.max(EFFORT_ORDER.indexOf(requested), floorIndex)

  for (let i = start + 1; i < EFFORT_ORDER.length; i++) {
    const candidate = EFFORT_ORDER[i]
    if (candidate !== undefined && allowed.includes(candidate)) {
      return candidate
    }
  }
  for (let i = start - 1; i >= floorIndex; i--) {
    const candidate = EFFORT_ORDER[i]
    if (candidate !== undefined && allowed.includes(candidate)) {
      return candidate
    }
  }

  // Nothing at or above the floor is supported; returning below it re-enters the caller's rule.
  return EFFORT_ORDER[floorIndex] ?? 'off'
}
