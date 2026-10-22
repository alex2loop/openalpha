import type { AdviceInput } from '@/trading/features/portfolio/folds/allocation'
import type {
  AbsoluteRebalancePlan,
  CashSegmentTarget,
  PositionChange,
  RebalancePolicyView,
  RebalanceUnavailableReason,
  ValuedBook,
  ValuedPosition,
  WeakHoldingNote,
} from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import { allocationRows, desiredWeights } from '@/trading/features/portfolio/folds/allocation'
import { isWeakHolding } from '@/trading/features/portfolio/folds/policy'
import { rebalanceRows } from '@/trading/features/portfolio/folds/rebalance'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { toProfileStamp } from '@/trading/kernel/operator/profile'

/** The readiness guard lives here so allocation and rebalance cannot emit rows for an incomplete
 *  book. Both arms carry the assessment, so findings survive either way. */
export function buildRebalancePlan(input: AdviceInput): AbsoluteRebalancePlan {
  const { findings } = input.assessment
  const caveats = planCaveats(input)
  const { freshness } = input.valued

  const basis = resolveSizingBasis(input.valued)

  if (basis.kind === 'unsizable') {
    return {
      advice: { kind: 'unavailable', reason: basis.reason, findings, caveats },
      sizing: null,
      regimes: input.regimes,
      ...(freshness === undefined ? {} : { freshness }),
    }
  }

  // A held instrument with no candidate has no price, lot, or turnover; omitting it would propose
  // weights that do not sum to the portfolio the user holds.
  if (!hasCompletePolicyInput(input)) {
    return {
      advice: { kind: 'unavailable', reason: 'insufficient-policy-input', findings, caveats },
      sizing: null,
      regimes: input.regimes,
      ...(freshness === undefined ? {} : { freshness }),
    }
  }

  const nav = basis.navBase
  // One distribution serves both arms: computing it twice would let allocation and rebalance
  // disagree about the same segment on the same run.
  const desired = desiredWeights(input, nav)
  const weak = weakHoldingRows(input)
  // Before the segment rows: each one reports where the plan leaves it, so the plan has to exist.
  const plan = rebalanceRows(input, nav, desired)
  const allocation = allocationRows(input, plan.rows)

  return {
    advice: {
      kind: 'ready',
      policy: advicePolicy(input, plan.deploymentScale),
      allocation,
      rebalance: plan.rows,
      cashSegment: cashSegmentAdvice(input, nav, plan.rows),
      weakHoldings: weak.rows,
      findings,
      caveats: [
        ...caveats,
        ...desired.caveats,
        ...weak.caveats,
        ...liquidityCaveats(input),
        ...plan.caveats,
      ],
    },
    sizing: {
      navBase: nav,
      baseCurrency: input.valued.book.baseCurrency,
      byInstrument: plan.sizes,
    },
    regimes: input.regimes,
    ...(freshness === undefined ? {} : { freshness }),
  }
}

/** Every arm carries the same qualifications: an advice that hides why deployment was capped, or
 *  which provider left a holding unpriced, is the omission this exists to prevent.
 *  `portfolio.valuation-partial` already names the unpriced holdings, so the generic partial-NAV
 *  note would state that fact twice. */
function planCaveats(input: AdviceInput): readonly Caveat[] {
  return [
    ...input.assessment.caveats,
    ...input.valued.caveats.filter((caveat) => caveat.code !== 'valuation.partial-nav'),
    ...[...input.regimes.values()].flatMap((regime) => regime.caveats),
  ]
}

/** Read from the same profile and regime the rows were built from, so the header can never describe
 *  a policy the numbers below it did not use. */
function advicePolicy(input: AdviceInput, scale: number): RebalancePolicyView {
  return {
    profile: toProfileStamp({ profile: input.profile, saved: input.profileSaved }),
    deploymentScale: scale,
  }
}

type SizingBasis =
  | { readonly kind: 'unsizable'; readonly reason: RebalanceUnavailableReason }
  | { readonly kind: 'sizable'; readonly navBase: number }

/** NAV is the denominator of every weight, so whether a book can be sized at all is decided from
 *  the valuation alone. Callers use it to skip the screen and the per-name pricing behind it when
 *  no candidate could change the answer. */
export function resolveSizingBasis(valued: ValuedBook): SizingBasis {
  if (valued.navBase === undefined) {
    return { kind: 'unsizable', reason: 'incomplete-valuation' }
  }

  if (valued.navBase <= 0) {
    return { kind: 'unsizable', reason: 'zero-nav' }
  }

  return { kind: 'sizable', navBase: valued.navBase }
}

function hasCompletePolicyInput(input: AdviceInput): boolean {
  if ([...input.regimes.values()].some((regime) => !Number.isFinite(regime.scale))) {
    return false
  }

  const candidates = new Map<string, AdviceInput['candidates'][number]>()

  for (const candidate of input.candidates) {
    const key = buildInstrumentKey(candidate.instrument)

    if (candidates.has(key) || !isValidCandidate(candidate)) {
      return false
    }

    candidates.set(key, candidate)
  }

  return input.valued.positions
    .filter((entry) => entry.kind === 'priced')
    .every((entry) => candidates.has(buildInstrumentKey(entry.position.instrument)))
}

function isValidCandidate(candidate: AdviceInput['candidates'][number]): boolean {
  const finite = [
    candidate.marketScore,
    candidate.unitPriceBase,
    candidate.boardLot,
    candidate.maximumPositionPctNav,
    ...(candidate.averageDailyTurnoverBase === undefined
      ? []
      : [candidate.averageDailyTurnoverBase]),
  ].every(Number.isFinite)

  // Positive, not integral: crypto trades in 0.0001 units, and both rounding sites floor by the lot.
  return (
    finite &&
    candidate.unitPriceBase > 0 &&
    candidate.boardLot > 0 &&
    candidate.maximumPositionPctNav >= 0 &&
    (candidate.averageDailyTurnoverBase === undefined || candidate.averageDailyTurnoverBase > 0)
  )
}

interface WeakHoldingFold {
  readonly rows: readonly WeakHoldingNote[]
  readonly caveats: readonly Caveat[]
}

// The signal is the market's own composite for the name. A holding above the threshold produces no
// row and no caveat. A missing signal produces a caveat naming the ticker, never a row: absent, not
// fabricated.
function weakHoldingRows(input: AdviceInput): WeakHoldingFold {
  const rows: WeakHoldingNote[] = []
  const caveats: Caveat[] = []
  const candidates = new Map(
    input.candidates.map((candidate) => [buildInstrumentKey(candidate.instrument), candidate])
  )

  for (const valued of input.valued.positions) {
    // `ready` requires every position priced; the union is checked rather than assumed.
    if (valued.kind !== 'priced') {
      continue
    }

    const candidate = candidates.get(buildInstrumentKey(valued.position.instrument))

    if (candidate === undefined) {
      caveats.push({
        code: 'portfolio.holding-signal-missing',
        detail: { ticker: valued.position.instrument.ticker },
      })
      continue
    }

    if (isWeakHolding(candidate.marketScore, candidate.instrumentKind)) {
      rows.push({ instrument: valued.position.instrument, signal: candidate.marketScore })
    }
  }

  return { rows, caveats }
}

// A holding whose turnover the market could not measure keeps its row; the caveat says the
// liquidity ceiling was not applied to it. Folded by position, not candidate, so the same name in
// two segments is one disclosure — and the weight tells the operator how much exposure is unmeasured.
function liquidityCaveats(input: AdviceInput): readonly Caveat[] {
  const liquidKeys = new Set(
    input.candidates
      .filter((candidate) => candidate.averageDailyTurnoverBase !== undefined)
      .map((candidate) => buildInstrumentKey(candidate.instrument))
  )

  return input.valued.positions
    .filter(
      (entry): entry is Extract<ValuedPosition, { kind: 'priced' }> =>
        entry.kind === 'priced' && !liquidKeys.has(buildInstrumentKey(entry.position.instrument))
    )
    .map((entry) => ({
      code: 'portfolio.candidate-illiquid' as const,
      detail: {
        ticker: entry.position.instrument.ticker,
        weight:
          input.valued.navBase === undefined
            ? 0
            : (entry.priceBase * entry.position.quantity) / input.valued.navBase,
      },
    }))
}

/** Only the excess above the reserve is term-deposit eligible. Settled cash, the same basis the
 *  `reserve-below-target` finding measures against: money that has not cleared can fund neither a
 *  purchase nor a deposit. Today's purchases are netted out, sale proceeds are not — they settle
 *  later. No rate, product, or banking action is invented. */
function cashSegmentAdvice(
  input: AdviceInput,
  nav: number,
  plan: readonly PositionChange[]
): CashSegmentTarget {
  const purchases = plan.reduce((sum, row) => sum + Math.max(row.changePctNav, 0), 0)
  // Currency cash is held at cost in the book; NAV and the segment table mark it at today's rate.
  const settledBase = input.valued.book.availableCashBase + (input.valued.currencyCashGainBase ?? 0)
  const cashPctNav = Math.max(settledBase / nav - purchases, 0)
  const liquidReservePctNav = Math.min(cashPctNav, input.profile.reservePctNav)
  const termDepositEligiblePctNav = Math.max(cashPctNav - liquidReservePctNav, 0)

  return {
    cashPctNav,
    liquidReservePctNav,
    termDepositEligiblePctNav,
    posture: termDepositEligiblePctNav > 0 ? 'term-deposit-eligible' : 'fully-liquid',
    // A reserve shortfall is already the `reserve-below-target` finding; one condition, one owner.
    caveats: [],
  }
}
