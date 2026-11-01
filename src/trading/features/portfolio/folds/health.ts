import type {
  PortfolioAssessment,
  PortfolioEvidence,
  PortfolioFinding,
  SegmentValue,
  ValuedBook,
  ValuedPosition,
} from '@/trading/features/portfolio/types'
import type { CaveatDetail } from '@/trading/kernel/caveat'
import type { InstrumentKind, InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { segmentEntries } from '@/trading/features/portfolio/folds/allocation'
import { PORTFOLIO_FINDING_KINDS } from '@/trading/kernel/caveat'
import { buildInstrumentKey, CASH_SEGMENT } from '@/trading/kernel/instrument'
import { isCappedAsFund } from '@/trading/kernel/operator/profile'

const CONCENTRATION_PCT_NAV = 0.2
const DRIFT_REPORT_PCT_POINTS = 0.05
const ILLIQUID_DAYS_TO_LIQUIDATE = 5

interface AssessInput {
  readonly profile: UserProfile
  readonly valued: ValuedBook
  readonly evidence: readonly PortfolioEvidence[]
  /** The lookup shape `valueBook` takes, so one registry read serves both. `undefined` means no
   *  registered market claims the instrument — a cap that cannot be checked, never a pass. */
  segmentFor(instrument: InstrumentRef): PortfolioSegment | undefined
  /** Keyed by `buildInstrumentKey`. A name whose kind never resolved is weighed as a single name. */
  readonly instrumentKinds: ReadonlyMap<string, InstrumentKind>
  /** Keyed by `buildInstrumentKey`. Absent means the input is missing, never that the name is liquid. */
  readonly daysToLiquidate?: ReadonlyMap<string, number>
}

/** The one advice path allowed to run on an incomplete valuation: "you are over your sector cap"
 *  is still true when one holding is unpriced. */
export function assessPortfolio(input: AssessInput): PortfolioAssessment {
  const findings: PortfolioFinding[] = []

  for (const rule of FINDING_RULES) {
    findings.push(...rule(input))
  }

  return {
    findings: sortFindings(findings),
    caveats:
      input.valued.navBase === undefined
        ? [
            {
              code: 'portfolio.valuation-partial',
              detail: { tickers: unpricedTickers(input.valued) },
            },
          ]
        : [],
  }
}

type FindingRule = (input: AssessInput) => readonly PortfolioFinding[]

function unpricedTickers(valued: ValuedBook): string {
  return valued.positions
    .filter((entry) => entry.kind === 'unpriced')
    .map((entry) => entry.position.instrument.ticker)
    .join(', ')
}

// Weight-based checks skip themselves when navBase is absent rather than dividing by a partial
// denominator; the exclusion and liquidity checks need no NAV.
const FINDING_RULES: readonly FindingRule[] = Object.freeze([
  segmentWeightFindings,
  positionWeightFindings,
  sectorWeightFindings,
  reserveFindings,
  exclusionFindings,
  liquidityFindings,
])

// PORTFOLIO_FINDING_KINDS declaration order; findings of one kind keep insertion order.
function sortFindings(findings: readonly PortfolioFinding[]): PortfolioFinding[] {
  return [...findings].sort(
    (left, right) =>
      PORTFOLIO_FINDING_KINDS.indexOf(left.kind) - PORTFOLIO_FINDING_KINDS.indexOf(right.kind)
  )
}

function segmentWeightFindings(input: AssessInput): readonly PortfolioFinding[] {
  if (input.valued.navBase === undefined) {
    return []
  }

  const held = input.valued.segmentValues.filter((value) => value.segment !== CASH_SEGMENT)
  const present = new Set(held.map((value) => value.segment))
  // A segment with a target and nothing in it is as far off that target as it can be.
  const empty = segmentEntries(input.profile.segmentTargets)
    .filter(([segment, target]) => segment !== CASH_SEGMENT && target > 0 && !present.has(segment))
    .map(([segment]) => ({ segment, valueBase: 0, weightPctNav: 0, etfPctNav: 0 }))

  return [...held, ...empty].flatMap((value) => segmentFindingsFor(input, value))
}

/** A segment can breach its ceiling and sit off its target at once, and each states a different
 *  second number, so the two rules are built apart rather than sharing one subject. */
function segmentFindingsFor(input: AssessInput, value: SegmentValue): readonly PortfolioFinding[] {
  const ceiling = input.profile.caps[value.segment]?.maximumSegmentPctNav
  const etfCeiling = input.profile.caps[value.segment]?.maximumEtfPctNav
  const target = input.profile.segmentTargets[value.segment]
  const weight = value.weightPctNav
  const shared = { segment: value.segment, weight }

  return [
    ...(ceiling !== undefined && weight > ceiling
      ? [
          buildFinding(input, {
            kind: 'segment-cap-breach',
            evidenceKind: 'segment-weight',
            subject: { ...shared, cap: ceiling },
          }),
        ]
      : []),
    ...(etfCeiling !== undefined && value.etfPctNav !== undefined && value.etfPctNav > etfCeiling
      ? [
          buildFinding(input, {
            kind: 'etf-cap-breach',
            evidenceKind: 'segment-weight',
            subject: {
              segment: value.segment,
              weight: value.etfPctNav,
              cap: etfCeiling,
            },
          }),
        ]
      : []),
    ...(target !== undefined && Math.abs(weight - target) >= DRIFT_REPORT_PCT_POINTS
      ? [
          buildFinding(input, {
            kind: 'segment-drift',
            evidenceKind: 'segment-weight',
            subject: { ...shared, target },
          }),
        ]
      : []),
  ]
}

function positionWeightFindings(input: AssessInput): readonly PortfolioFinding[] {
  const nav = input.valued.navBase

  if (nav === undefined) {
    return []
  }

  return input.valued.positions.flatMap((entry) =>
    entry.kind === 'priced' ? positionFindingsFor(input, entry, entry.valueBase / nav) : []
  )
}

/** A name over its segment's per-name cap is usually also concentrated, and both rows are wanted:
 *  one names a policy the operator set, the other a level that is heavy under any policy. Neither
 *  describes a fund that answers to the segment's ETF ceiling, whose own finding reports it. */
function positionFindingsFor(
  input: AssessInput,
  entry: Extract<ValuedPosition, { readonly kind: 'priced' }>,
  weight: number
): readonly PortfolioFinding[] {
  const { instrument } = entry.position
  const segment = input.segmentFor(instrument)
  const caps = segment === undefined ? undefined : input.profile.caps[segment]
  const ticker = instrument.ticker

  if (isCappedAsFund(caps, input.instrumentKinds.get(buildInstrumentKey(instrument)))) {
    return []
  }

  const cap = caps?.maximumPositionPctNav

  return [
    ...(cap !== undefined && segment !== undefined && weight > cap
      ? [
          buildFinding(input, {
            kind: 'position-cap-breach',
            evidenceKind: 'position-weight',
            subject: { ticker, segment, weight, cap },
          }),
        ]
      : []),
    ...(weight >= CONCENTRATION_PCT_NAV
      ? [
          buildFinding(input, {
            kind: 'concentration',
            evidenceKind: 'position-weight',
            subject: {
              ticker,
              weight,
              cap: CONCENTRATION_PCT_NAV,
            },
          }),
        ]
      : []),
  ]
}

function sectorWeightFindings(input: AssessInput): readonly PortfolioFinding[] {
  if (input.valued.navBase === undefined) {
    return []
  }

  return input.valued.sectorValues
    .filter((value) => value.weightPctNav > input.profile.maximumSectorPctNav)
    .map((value) =>
      buildFinding(input, {
        kind: 'sector-cap-breach',
        evidenceKind: 'sector-weight',
        subject: {
          sector: value.sector,
          weight: value.weightPctNav,
          cap: input.profile.maximumSectorPctNav,
        },
      })
    )
}

function reserveFindings(input: AssessInput): readonly PortfolioFinding[] {
  const nav = input.valued.navBase

  if (nav === undefined || nav <= 0) {
    return []
  }

  // Settled cash only: sizing carves the reserve out of `availableCashBase`, so a reserve measured
  // over unsettled sell proceeds would report a cushion the next buy cannot spend.
  const cashWeight = input.valued.book.availableCashBase / nav

  return cashWeight < input.profile.reservePctNav
    ? [
        buildFinding(input, {
          kind: 'reserve-below-target',
          evidenceKind: 'cash-weight',
          subject: {
            weight: cashWeight,
            target: input.profile.reservePctNav,
          },
        }),
      ]
    : []
}

function exclusionFindings(input: AssessInput): readonly PortfolioFinding[] {
  const excluded = new Set(input.profile.exclusions.map(buildInstrumentKey))

  return input.valued.positions
    .filter((entry) => excluded.has(buildInstrumentKey(entry.position.instrument)))
    .map((entry) =>
      buildFinding(input, {
        kind: 'excluded-holding',
        evidenceKind: 'position-weight',
        subject: { ticker: entry.position.instrument.ticker },
      })
    )
}

function liquidityFindings(input: AssessInput): readonly PortfolioFinding[] {
  const findings: PortfolioFinding[] = []

  for (const entry of input.valued.positions) {
    const days = input.daysToLiquidate?.get(buildInstrumentKey(entry.position.instrument))

    // Absent data is caveated by whoever produced it; nothing is fabricated here.
    if (days !== undefined && days > ILLIQUID_DAYS_TO_LIQUIDATE) {
      findings.push(
        buildFinding(input, {
          kind: 'illiquid-position',
          evidenceKind: 'days-to-liquidate',
          subject: { ticker: entry.position.instrument.ticker, days },
        })
      )
    }
  }

  return findings
}

interface FindingSpec {
  readonly kind: PortfolioFinding['kind']
  readonly evidenceKind: PortfolioEvidence['kind']
  /** Which holding, segment, sector, or group this finding is about. Every rule supplies it, so two
   *  breaches of one kind can never render as the same sentence. */
  readonly subject: CaveatDetail
}

// Typed evidence, never prose: a surface renders `trading.finding.<kind>` with `subject` interpolated.
function buildFinding(input: AssessInput, spec: FindingSpec): PortfolioFinding {
  const evidence = input.evidence.filter((entry) => entry.kind === spec.evidenceKind)

  return {
    kind: spec.kind,
    direction: 'negative',
    subject: spec.subject,
    evidence:
      evidence.length > 0 ? evidence : [{ kind: spec.evidenceKind, provenance: [], caveats: [] }],
  }
}
