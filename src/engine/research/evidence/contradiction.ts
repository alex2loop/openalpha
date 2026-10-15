import type { EvidenceConflict } from './gaps'
import type { ResearchClaim } from './model'
import { normalizeClaimKeyText } from './normalize'
import { RELATIVE_VALUE_TOLERANCE } from './numeric'

const GROUP_KEY_SEPARATOR = ' '

type NumericClaim = Extract<ResearchClaim, { readonly kind: 'numeric' }>

interface ComparableClaim {
  readonly claim: NumericClaim
  readonly value: number
  readonly key: string
}

/**
 * Conflicts between admitted numeric outcome claims that state the same measure — normalized unit,
 * order-insensitive scope tokens, and effective day all equal — with values beyond rounding
 * distance. Units are compared, never converted: a figure in another denomination (or another
 * language's unit wording) is skipped, so every reported contradiction is an exact comparison.
 */
export function factualContradictions(
  claims: readonly ResearchClaim[]
): readonly EvidenceConflict[] {
  const groups = new Map<string, ComparableClaim[]>()
  for (const claim of claims) {
    const entry = comparableClaim(claim)
    if (entry === undefined) {
      continue
    }
    const group = groups.get(entry.key) ?? []
    group.push(entry)
    groups.set(entry.key, group)
  }

  const conflicts: EvidenceConflict[] = []
  for (const group of groups.values()) {
    if (group.length < 2 || !valuesDisagree(group.map((entry) => entry.value))) {
      continue
    }
    conflicts.push({
      code: 'factual_contradiction',
      claimIds: group.map((entry) => entry.claim.id),
      excerptIds: [...new Set(group.flatMap((entry) => entry.claim.evidenceIds))],
      message: 'admitted numeric claims disagree on the same measure, scope, and day',
    })
  }
  return conflicts
}

function comparableClaim(claim: ResearchClaim): ComparableClaim | undefined {
  // Two forecasts that differ are two views, not a contradiction, and a forecast cannot contradict
  // the outcome it anticipated.
  if (claim.kind !== 'numeric' || claim.forecast === true) {
    return undefined
  }

  const value = Number.parseFloat(claim.number.value)
  const unit = normalizeClaimKeyText(claim.number.unit)
  const scope = scopeKey(claim.number.scope)
  if (!Number.isFinite(value) || unit === '' || scope === '') {
    return undefined
  }
  return {
    claim,
    value,
    key: [unit, scope, claim.number.effectiveOn].join(GROUP_KEY_SEPARATOR),
  }
}

// Sources word the same referent differently; token order and repetition are not identity.
function scopeKey(scope: string): string {
  return [...new Set(normalizeClaimKeyText(scope).split(' ').filter(Boolean))].sort().join(' ')
}

function valuesDisagree(values: readonly number[]): boolean {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const magnitude = Math.max(Math.abs(min), Math.abs(max))
  if (magnitude === 0) {
    return false
  }
  return (max - min) / magnitude > RELATIVE_VALUE_TOLERANCE
}
