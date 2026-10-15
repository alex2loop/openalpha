// Substring markers, matched against the lowercased model string.
const DEEP_MARKERS: readonly string[] = ['-opus', '-pro', '-reasoner', '-thinking']
// Anchored: 'o1'/'o3' as a substring would fire on unrelated names.
const DEEP_PREFIXES: readonly string[] = ['o1', 'o3']
const FAST_MARKERS: readonly string[] = ['-mini', '-flash', '-haiku', '-lite']

// Best-effort labelling for UI and logging — never a correctness-critical path. A model that
// classifies as `balanced` when it is really `deep` costs a wrong badge, nothing more.
export type ModelTier = 'fast' | 'balanced' | 'deep'

export interface ModelClass {
  readonly tier: ModelTier
  readonly reasoning: boolean
}

export function classifyModel(model: string): ModelClass {
  const name = model.toLowerCase()

  if (
    DEEP_MARKERS.some((marker) => name.includes(marker)) ||
    DEEP_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return { tier: 'deep', reasoning: true }
  }

  if (FAST_MARKERS.some((marker) => name.includes(marker))) {
    return { tier: 'fast', reasoning: false }
  }

  return { tier: 'balanced', reasoning: false }
}
