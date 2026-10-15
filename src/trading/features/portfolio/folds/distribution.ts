import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { CapReason } from '@/trading/features/portfolio/types'
import {
  DEFAULT_SIZING_VOLATILITY_DAILY,
  MINIMUM_SIZING_VOLATILITY_DAILY,
} from '@/trading/features/portfolio/folds/policy'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

// A remainder below one basis point of NAV is smaller than any order could express.
export const DISTRIBUTION_EPSILON = 1e-4

export interface CapBind {
  readonly reason: CapReason
  readonly capPctNav: number
}

export interface Ceiling {
  readonly value: number
  readonly reason: CapReason
}

export type CeilingFor = (candidate: PortfolioCandidate, current: number) => Ceiling

interface Distribution {
  readonly weights: ReadonlyMap<string, number>
  readonly residue: number
  readonly bind: CapBind | null
}

interface DistributeLimits {
  readonly ceilingFor: CeilingFor
  onAssign(candidate: PortfolioCandidate, delta: number): void
}

interface BindTracker {
  frozen: number
  bind: CapBind | null
}

// Each pass assigns the unallocated remainder proportional to risk-adjusted score, freezes
// whatever hit its ceiling, and repeats with the overflow. It stops when no overflow remains or no
// receiver does.
export function distribute(
  candidates: readonly PortfolioCandidate[],
  target: number,
  limits: DistributeLimits
): Distribution {
  const assigned = new Map<string, number>()
  const widest: BindTracker = { frozen: 0, bind: null }
  let receivers: readonly PortfolioCandidate[] = candidates
  let remaining = target

  while (remaining > DISTRIBUTION_EPSILON && receivers.length > 0) {
    const pass = assignPass({ receivers, remaining, assigned, limits, widest })

    if (pass === null) {
      break
    }

    remaining -= pass.assigned
    receivers = pass.stillOpen

    if (pass.assigned <= DISTRIBUTION_EPSILON) {
      break
    }
  }

  return { weights: assigned, residue: Math.max(0, remaining), bind: widest.bind }
}

interface PassInput {
  readonly receivers: readonly PortfolioCandidate[]
  readonly remaining: number
  readonly assigned: Map<string, number>
  readonly limits: DistributeLimits
  readonly widest: BindTracker
}

interface Pass {
  readonly stillOpen: readonly PortfolioCandidate[]
  readonly assigned: number
}

/** One proportional pass. `null` when no receiver carries a positive score, which no later pass can
 *  change — the caller stops rather than looping on a share nobody can take. */
function assignPass(input: PassInput): Pass | null {
  const shares = input.receivers.map(riskAdjustedScore)
  const totalShare = shares.reduce((sum, share) => sum + share, 0)

  if (totalShare <= 0) {
    return null
  }

  const stillOpen: PortfolioCandidate[] = []
  let assigned = 0

  for (const [index, candidate] of input.receivers.entries()) {
    const key = buildInstrumentKey(candidate.instrument)
    const current = input.assigned.get(key) ?? 0
    const ceiling = input.limits.ceilingFor(candidate, current)
    const next = Math.min(
      ceiling.value,
      current + input.remaining * ((shares[index] ?? 0) / totalShare)
    )

    input.assigned.set(key, next)
    input.limits.onAssign(candidate, next - current)
    assigned += next - current

    if (next < ceiling.value) {
      stillOpen.push(candidate)
      continue
    }

    recordBind(input.widest, next, ceiling)
  }

  return { stillOpen, assigned }
}

function recordBind(widest: BindTracker, weight: number, ceiling: Ceiling): void {
  if (weight > widest.frozen) {
    widest.frozen = weight
    widest.bind = { reason: ceiling.reason, capPctNav: ceiling.value }
  }
}

/** Score per unit of risk. Two names the market rates equally are not equally sized when one
 *  moves four times as far in a day. */
function riskAdjustedScore(candidate: PortfolioCandidate): number {
  const volatility = Math.max(
    candidate.volatilityDaily ?? DEFAULT_SIZING_VOLATILITY_DAILY,
    MINIMUM_SIZING_VOLATILITY_DAILY
  )

  return candidate.marketScore / volatility
}
