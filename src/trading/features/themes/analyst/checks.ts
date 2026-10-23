import type {
  SectorEntryReply,
  ThemeCompanyReply,
  ThemeDiscoveryReply,
  ThemeProposalReply,
  ThemeSectorReply,
  ThemeUpdateReply,
} from '@/trading/features/themes/analyst/schemas'
import type { CompanyFacts } from '@/trading/features/themes/chain/company-facts'
import type { PeRange } from '@/trading/features/themes/chain/company-market'
import type {
  EvidenceItem,
  EvidenceKind,
  ExposureLabel,
  SectorFigures,
  SectorRead,
  StockExposure,
  StockRead,
  Theme,
  ThemeClaim,
  ThemeId,
  ThemeMaturity,
  ThemeRead,
  ThemeSector,
} from '@/trading/features/themes/types'
import { isHardEvidence } from '@/trading/features/themes/evidence/bundle'
import { formatFigure } from '@/trading/features/themes/evidence/series'
import { SCENARIO_CASES, themeId } from '@/trading/features/themes/types'

const MINIMUM_FOUNDING_ORIGINS = 2
const FULL_PROBABILITY_PCT = 100
/** How much of the exposure rests on what is promised rather than what is booked: an emerging
 *  theme has little revenue yet, a mature one is mostly in the accounts (FTSE Russell). */
const FORWARD_WEIGHT: Readonly<Record<ThemeMaturity, number>> = Object.freeze({
  emerging: 0.7,
  scaling: 0.5,
  mature: 0.3,
})
/** Highest first; below the last band is `low`. */
const EXPOSURE_BANDS: readonly { readonly label: ExposureLabel; readonly fromPct: number }[] =
  Object.freeze([
    { label: 'very-high', fromPct: 50 },
    { label: 'high', fromPct: 25 },
    { label: 'medium', fromPct: 10 },
  ])

type EvidenceIndex = ReadonlyMap<string, EvidenceItem>

export type CheckResult<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }

export interface Proposal {
  readonly theme: Theme
  readonly read: ThemeRead
}

interface UpdateCheck {
  readonly theme: Theme
  readonly previous?: ThemeRead
  readonly index: EvidenceIndex
}

interface DiscoveryCheck {
  readonly known: ReadonlySet<string>
  readonly index: EvidenceIndex
  readonly now: number
}

interface SectorCheck {
  readonly themeId: ThemeId
  readonly index: EvidenceIndex
  readonly figures: ReadonlyMap<ThemeSector, SectorFigures>
}

interface CompanyCheck {
  readonly themeId: ThemeId
  readonly sector: ThemeSector
  readonly maturity: ThemeMaturity
  readonly index: EvidenceIndex
  readonly facts: CompanyFacts
  readonly quality: number
}

interface CitedCompany {
  readonly exposureBasis: readonly ThemeClaim[]
  readonly chain: readonly ThemeClaim[]
  readonly pricedIn?: ThemeClaim
  readonly risks: readonly ThemeClaim[]
}

/** An id the bundle does not hold is dropped, and a claim left citing nothing goes with it. */
function keepCited(
  claims: readonly { text: string; evidence: readonly string[] }[],
  index: EvidenceIndex
): readonly ThemeClaim[] {
  return claims.flatMap((claim) => {
    const evidence = [...new Set(claim.evidence)].filter((id) => index.has(id))

    return evidence.length === 0 ? [] : [{ text: claim.text, evidence }]
  })
}

function citesHardEvidence(claims: readonly ThemeClaim[], index: EvidenceIndex): boolean {
  return claims.some((claim) => claim.evidence.some((id) => isHardEvidence(index.get(id))))
}

/** Two independent sources, one of them hard data: news alone cannot found a theme. */
function isFounded(claims: readonly ThemeClaim[], index: EvidenceIndex): boolean {
  const items = claims.flatMap((claim) => claim.evidence.flatMap((id) => index.get(id) ?? []))

  return (
    new Set(items.map((item) => item.origin)).size >= MINIMUM_FOUNDING_ORIGINS &&
    items.some((item) => isHardEvidence(item))
  )
}

function updateIssues(
  reply: ThemeUpdateReply,
  check: UpdateCheck,
  counter: readonly ThemeClaim[]
): readonly string[] {
  const issues = counter.length === 0 ? ['counter: no claim cites an id in the bundle'] : []

  if (reply.invalidatedBy === undefined) {
    return issues
  }

  return [
    ...issues,
    ...(check.theme.invalidation[reply.invalidatedBy - 1] === undefined
      ? [`invalidatedBy: there is no condition ${reply.invalidatedBy}`]
      : []),
    ...(citesHardEvidence(counter, check.index)
      ? []
      : ['invalidatedBy: back it with a counter claim citing M or C evidence']),
  ]
}

export function checkUpdate(reply: ThemeUpdateReply, check: UpdateCheck): CheckResult<ThemeRead> {
  const counter = keepCited(reply.counter, check.index)
  const issues = updateIssues(reply, check, counter)

  if (issues.length > 0) {
    return { kind: 'invalid', issues }
  }

  const condition =
    reply.invalidatedBy === undefined
      ? undefined
      : check.theme.invalidation[reply.invalidatedBy - 1]

  return {
    kind: 'value',
    value: {
      themeId: check.theme.id,
      status: condition === undefined ? reply.status : 'invalidated',
      maturity: reply.maturity,
      probabilityPct: reply.probabilityPct,
      ...(check.previous === undefined
        ? {}
        : { previousProbabilityPct: check.previous.probabilityPct }),
      horizonMonths: reply.horizonMonths,
      summary: reply.summary,
      supporting: keepCited(reply.supporting, check.index),
      counter,
      web: reply.web,
      ...(condition === undefined ? {} : { invalidatedBy: condition }),
    },
  }
}

function toProposal(reply: ThemeProposalReply, check: DiscoveryCheck): Proposal | undefined {
  const supporting = keepCited(reply.supporting, check.index)
  const counter = keepCited(reply.counter, check.index)
  const id = themeId(reply.id)
  const beneficiaries = [...new Set(reply.beneficiaries)]

  // A change no listed sector gains from is a risk to other themes, not a theme of its own.
  if (
    check.known.has(id) ||
    beneficiaries.length === 0 ||
    counter.length === 0 ||
    !isFounded(supporting, check.index)
  ) {
    return undefined
  }

  return {
    theme: {
      id,
      title: reply.title,
      thesis: reply.thesis,
      status: 'proposed',
      maturity: reply.maturity,
      invalidation: reply.invalidation,
      createdAt: check.now,
      updatedAt: check.now,
    },
    read: {
      themeId: id,
      status: 'proposed',
      maturity: reply.maturity,
      probabilityPct: reply.probabilityPct,
      horizonMonths: reply.horizonMonths,
      summary: reply.summary,
      supporting,
      counter,
      web: reply.web,
      beneficiaries,
    },
  }
}

/** A proposal that fails a rule is dropped alone; the rest of the reply stands. */
export function acceptProposals(
  reply: ThemeDiscoveryReply,
  check: DiscoveryCheck
): CheckResult<readonly Proposal[]> {
  const accepted: Proposal[] = []

  for (const proposal of reply.proposals) {
    const known = new Set([...check.known, ...accepted.map((entry) => entry.theme.id)])
    const kept = toProposal(proposal, { ...check, known })

    if (kept !== undefined) {
      accepted.push(kept)
    }
  }

  return { kind: 'value', value: accepted }
}

/** A sector left with no cited counter claim is dropped alone; a reply that loses every sector it
 *  named is re-asked. Naming none is an answer. */
export function checkSectors(
  reply: ThemeSectorReply,
  check: SectorCheck
): CheckResult<readonly SectorRead[]> {
  const unique = reply.sectors.filter(
    (entry, index) => reply.sectors.findIndex((other) => other.sector === entry.sector) === index
  )
  const reads = unique.flatMap((entry) => toSectorRead(entry, check) ?? [])

  if (unique.length > 0 && reads.length === 0) {
    return {
      kind: 'invalid',
      issues: unique.map((entry) => `${entry.sector}.counter: no claim cites an id you were given`),
    }
  }

  return { kind: 'value', value: reads }
}

function toSectorRead(entry: SectorEntryReply, check: SectorCheck): SectorRead | undefined {
  const counter = keepCited(entry.counter, check.index)

  return counter.length === 0
    ? undefined
    : {
        themeId: check.themeId,
        sector: entry.sector,
        linkage: entry.linkage,
        effect: entry.effect,
        chain: entry.chain,
        criteria: entry.criteria,
        figures: check.figures.get(entry.sector) ?? {},
        supporting: keepCited(entry.supporting, check.index),
        counter,
        web: entry.web,
      }
}

export function checkCompany(
  reply: ThemeCompanyReply,
  check: CompanyCheck
): CheckResult<Omit<StockRead, 'ticker'>> {
  const [pricedIn] = keepCited([reply.pricedIn], check.index)
  const cited: CitedCompany = {
    exposureBasis: keepCited(reply.exposureBasis, check.index),
    chain: keepCited(reply.chain, check.index),
    risks: keepCited(reply.risks, check.index),
    ...(pricedIn === undefined ? {} : { pricedIn }),
  }
  const issues = companyIssues(reply, check, cited)

  if (issues.length > 0 || cited.pricedIn === undefined) {
    return { kind: 'invalid', issues }
  }

  return { kind: 'value', value: toStockRead(reply, check, { ...cited, pricedIn: cited.pricedIn }) }
}

function companyIssues(
  reply: ThemeCompanyReply,
  check: CompanyCheck,
  cited: CitedCompany
): readonly string[] {
  return [
    ...(cited.risks.length === 0 ? ['risks: no claim cites an id you were given'] : []),
    ...(cited.chain.length === 0 ? ['chain: no claim cites an id you were given'] : []),
    ...(cited.exposureBasis.length === 0
      ? ['exposureBasis: no claim cites an id you were given']
      : []),
    ...(cited.pricedIn === undefined ? ['pricedIn: cite the V or P figures it rests on'] : []),
    ...(reply.verdict === 'earnings' && !citesKind(cited.chain, check.index, 'accounts')
      ? ['verdict: "earnings" needs a chain claim citing A figures']
      : []),
    ...scenarioIssues(reply.scenarios, check.facts.peRange),
  ]
}

function scenarioIssues(
  scenarios: ThemeCompanyReply['scenarios'],
  range: PeRange | undefined
): readonly string[] {
  const total = SCENARIO_CASES.reduce((sum, key) => sum + scenarios[key].probabilityPct, 0)
  const odds =
    total === FULL_PROBABILITY_PCT
      ? []
      : [`scenarios: probabilities sum to ${total}, not ${FULL_PROBABILITY_PCT}`]

  return range === undefined ? odds : [...odds, ...targetPeIssues(scenarios, range)]
}

/** Only where the name has a P/E history, and only above it: a target below the five-year low is
 *  the cautious side, and refusing it would drop the name for being careful. */
function targetPeIssues(
  scenarios: ThemeCompanyReply['scenarios'],
  range: PeRange
): readonly string[] {
  const high = formatFigure(range.max)

  // Held to the high as the prompt printed it, so a target set exactly there passes.
  return SCENARIO_CASES.filter((key) => scenarios[key].targetPe > Number(high)).map(
    (key) => `scenarios.${key}.targetPe: above the five-year high ${high}`
  )
}

function toStockRead(
  reply: ThemeCompanyReply,
  check: CompanyCheck,
  cited: CitedCompany & { readonly pricedIn: ThemeClaim }
): Omit<StockRead, 'ticker'> {
  const { facts } = check

  return {
    themeId: check.themeId,
    sector: check.sector,
    exposure: toExposure(reply, check.maturity),
    exposureBasis: cited.exposureBasis,
    verdict: reply.verdict,
    chain: cited.chain,
    pricedIn: cited.pricedIn,
    scenarios: reply.scenarios,
    risks: cited.risks,
    catalysts: keepCited(reply.catalysts, check.index),
    invalidation: reply.invalidation,
    horizonMonths: reply.horizonMonths,
    crowding: facts.crowding,
    quality: check.quality,
    missing: facts.missing,
    web: reply.web,
    ...(facts.surprise === undefined ? {} : { surprise: facts.surprise }),
    ...(facts.pe === undefined ? {} : { pe: facts.pe }),
    ...(facts.close === undefined ? {} : { close: facts.close }),
    ...(facts.benchmark === undefined ? {} : { benchmark: facts.benchmark }),
  }
}

function toExposure(reply: ThemeCompanyReply, maturity: ThemeMaturity): StockExposure {
  const weight = FORWARD_WEIGHT[maturity]
  const blendedPct = Math.round(
    weight * reply.forwardSharePct + (1 - weight) * reply.estimatedRevenueSharePct
  )

  return {
    estimatedRevenueSharePct: reply.estimatedRevenueSharePct,
    forwardSharePct: reply.forwardSharePct,
    blendedPct,
    label:
      reply.direction === 'hurt'
        ? 'negative'
        : (EXPOSURE_BANDS.find((band) => blendedPct >= band.fromPct)?.label ?? 'low'),
  }
}

function citesKind(
  claims: readonly ThemeClaim[],
  index: EvidenceIndex,
  kind: EvidenceKind
): boolean {
  return claims.some((claim) => claim.evidence.some((id) => index.get(id)?.kind === kind))
}
