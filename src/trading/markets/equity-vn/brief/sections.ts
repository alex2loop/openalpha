import type { Exact } from '@/core/types/exact'
import type {
  BookPositionSummary,
  BookSummary,
  BriefAlertRow,
  ListSinceOptions,
} from '@/trading/features/brief/types'
import type { SegmentTarget } from '@/trading/features/portfolio/types'
import type { StoredSuggestion, SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { DebateMode } from '@/trading/kernel/config'
import type { CurrencyCode, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { StopDistance } from '@/trading/kernel/operator/alert'
import type {
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
  BriefStopBasis,
} from '@/trading/kernel/operator/brief-section'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { isInconclusive } from '@/trading/features/suggestion/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { stopStandingOf } from '@/trading/kernel/operator/alert'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** The brief pays one debate per watchlist name, unattended, every morning. The full debate is what
 *  `/suggest` spends on a ticker the operator named. */
const BRIEF_DEBATE_MODE = 'lean' satisfies DebateMode
/** What a call served from earlier in the day carries when the book has moved since it was made. */
const BOOK_MOVED_CODES: ReadonlySet<CaveatCode> = new Set<CaveatCode>([
  'suggestion.book-changed',
  'suggestion.position-changed',
])

/** The one stop vocabulary the tree speaks. A builder that composed its own sentence would be
 *  writing copy; the tuple in `brief-section.ts` owns the arms. */
const STOP_BASIS: BriefStopBasis = 'volatility-resting'

export type SectionBuilder = (context: BriefContext) => Promise<BriefSectionResult>

interface ReadyMeta {
  readonly caveats?: readonly Caveat[]
  readonly provenance?: readonly SourceProvenance[]
  readonly titleParams?: Readonly<Record<string, string | number>>
  /** The session these rows describe, where the builder reads one that the VN overview's own day
   *  does not already stamp — the macro sections, which belong to the region rather than to it. */
  readonly asOf?: TradingDay
  /** What the rows' money is in, where the section carries an amount the market's own currency does
   *  not name. The book's value is the operator's, not any one market's. */
  readonly currency?: CurrencyCode
}

/** Domain snapshots carry values only. Surfaces own localized titles, labels, and formatting. */
export function ready<R extends BriefSectionRow>(
  kind: BriefSectionKind,
  rows: readonly Exact<BriefSectionRow, R>[],
  meta: ReadyMeta = {}
): BriefSectionResult {
  return {
    kind,
    status: 'ready',
    rows,
    ...(meta.asOf === undefined ? {} : { asOf: meta.asOf }),
    ...(meta.currency === undefined ? {} : { currency: meta.currency }),
    ...(meta.titleParams === undefined ? {} : { titleParams: meta.titleParams }),
    provenance: meta.provenance ?? [],
    caveats: meta.caveats ?? [],
  }
}

/** "Nothing resolved since your last brief" and "we could not reach the suggestion store" look
 *  identical to a user if both render as a missing section, and only the second is a problem. */
export function omitted(kind: BriefSectionKind): BriefSectionResult {
  return { kind, status: 'omitted-by-policy', caveats: [] }
}

export function absent(
  kind: BriefSectionKind,
  caveats: readonly Caveat[] = []
): BriefSectionResult {
  return { kind, status: 'unavailable', caveats }
}

/** The one number every operator checks first. Omitted, never zero, before the first ledger entry:
 *  a book that holds nothing has no value to report. A holding with no price leaves the total
 *  unknown, which is unavailable rather than omitted: the book exists and must not read as empty. */
export async function buildBookSummary(context: BriefContext): Promise<BriefSectionResult> {
  const book = await context.bookSummary()

  if (book === null) {
    return omitted('book-summary')
  }

  return book.nav === undefined
    ? absent('book-summary', [{ code: 'brief.book-unpriced' }])
    : ready('book-summary', [{ nav: book.nav }], { currency: book.currency })
}

export async function buildResolvedSuggestions(context: BriefContext): Promise<BriefSectionResult> {
  const rows = await context.services.listResolvedSuggestions(sinceOptions(context))

  return rows.length === 0
    ? omitted('resolved-suggestions')
    : ready(
        'resolved-suggestions',
        rows.map((row) => ({
          ticker: row.instrument.ticker,
          at: row.at,
          status: row.outcome.status,
          returnPct: row.outcome.returnPct,
        })),
        { provenance: rows.flatMap((row) => row.provenance) }
      )
}

export async function buildFiredAlerts(context: BriefContext): Promise<BriefSectionResult> {
  const rows = await context.services.listFiredAlerts(sinceOptions(context))

  return rows.length === 0 ? omitted('fired-alerts') : levelSection('fired-alerts', rows)
}

/** Held names that have already crossed a buy suggestion's stop or target, by the suggestion's own
 *  levels. Same shape as fired alerts — a position that is done does not need a human to remember the
 *  plan; it needs the plan read back at this morning's price. */
export async function buildPositionExits(context: BriefContext): Promise<BriefSectionResult> {
  const rows = await context.services.positionExits({
    now: context.request.now,
    signal: context.request.signal,
  })

  return rows.length === 0 ? omitted('position-exits') : levelSection('position-exits', rows)
}

/** A board-scaled price names no currency on its row; the scale is stated once, as a note. */
function levelSection(kind: BriefSectionKind, rows: readonly BriefAlertRow[]): BriefSectionResult {
  const boards = new Map(
    rows.flatMap((row) =>
      row.board === undefined || row.currency === undefined
        ? []
        : [[row.board.segment, { ...row.board, currency: row.currency }] as const]
    )
  )

  return ready(kind, rows.map(toLevelRow), {
    caveats: [...boards.values()].map((detail) => ({
      code: 'market-data.board-scaled' as const,
      detail,
    })),
  })
}

function toLevelRow(row: BriefAlertRow): BriefSectionRow {
  return {
    ticker: row.instrument.ticker,
    condition: row.condition,
    threshold: row.threshold,
    observedPrice: row.observedPrice,
    ...(row.currency === undefined || row.board !== undefined ? {} : { currency: row.currency }),
  }
}

/** How much of the book is under water and whether its plans still hold. A state report, never
 *  advice: it counts, it does not tell the operator to sell or to wait. Omitted when nothing is
 *  below cost — there is no reassuring arm worth printing daily. */
export async function buildPositionsInLoss(context: BriefContext): Promise<BriefSectionResult> {
  const book = await context.bookSummary()

  if (book === null) {
    return omitted('positions-in-loss')
  }

  const losing = losingPositions(book)

  if (losing.length === 0) {
    return omitted('positions-in-loss')
  }

  const distances = await context.services.stopDistances({
    now: context.request.now,
    signal: context.request.signal,
    marks: book.marks,
  })
  const stops = stopTally(losing, distances)

  // A stop tally of zero is a count with nothing behind it; the losing count already bounds them.
  return ready('positions-in-loss', [
    {
      losingCount: losing.length,
      losingReturnPct: aggregateReturnPct(losing),
      ...(stops.clear === 0 ? {} : { stopClearCount: stops.clear }),
      ...(stops.breached === 0 ? {} : { stopBreachedCount: stops.breached }),
      ...(stops.unmeasured === 0 ? {} : { stopUnmeasuredCount: stops.unmeasured }),
    },
  ])
}

/** Holdings worth less than was paid for them. */
function losingPositions(book: BookSummary): readonly BookPositionSummary[] {
  return book.positions.filter((position) => position.valueBase < position.costBase)
}

interface StopTally {
  readonly breached: number
  readonly clear: number
  readonly unmeasured: number
}

/** Losing holdings by where each stands against its own stop, looked up above the loop: one map for
 *  the book, never one per row. A holding the watch never measured counts as unmeasured — folded
 *  into `clear` it reported protection nobody compared, and a hold's stop is never a distance. */
function stopTally(
  losing: readonly BookPositionSummary[],
  distances: readonly StopDistance[]
): StopTally {
  const byInstrument = new Map(
    distances.map((distance) => [buildInstrumentKey(distance.instrument), distance])
  )
  const tally = { breached: 0, clear: 0, unmeasured: 0 }

  for (const position of losing) {
    const distance = byInstrument.get(buildInstrumentKey(position.instrument))

    tally[distance === undefined ? 'unmeasured' : stopStandingOf(distance)] += 1
  }

  return tally
}

/** The losing leg's own return, cost-weighted: what the under-water part of the book did. */
function aggregateReturnPct(losing: readonly BookPositionSummary[]): number {
  const cost = losing.reduce((sum, position) => sum + position.costBase, 0)
  const value = losing.reduce((sum, position) => sum + position.valueBase, 0)

  return cost <= 0 ? 0 : value / cost - 1
}

/** The operator's own standing limits, restated each morning. Policy, not a market fact, which is
 *  why it may repeat daily where a market number may not. The first row carries two fields on
 *  purpose: a lone first field would ride the section title bare, and the title names the block
 *  rather than the number. */
export async function buildDiscipline(context: BriefContext): Promise<BriefSectionResult> {
  // The rules size trades the operator cannot make until a book exists.
  if ((await context.bookSummary()) === null) {
    return omitted('discipline')
  }

  const profile = await context.services.profile({
    now: context.request.now,
    signal: context.request.signal,
  })

  return ready('discipline', [
    { riskPerTradePctNav: profile.riskPerTradePctNav, stopBasis: STOP_BASIS },
    {
      entryTranchePct: profile.entryTranchePct,
      takeProfitTranchePct: profile.takeProfitTranchePct,
    },
    {
      reservePctNav: profile.reservePctNav,
      maximumSectorPctNav: profile.maximumSectorPctNav,
    },
  ])
}

/** Reuses the portfolio's own drift band. The brief never re-derives it: two owners of the 5/25
 *  rule would eventually nudge a user about a segment the rebalancer considers in band. */
export async function buildDriftNudge(context: BriefContext): Promise<BriefSectionResult> {
  const advice = await context.rebalance()

  if (advice.kind === 'unavailable') {
    return omitted('drift-nudge')
  }

  const drifted = advice.allocation.filter(isOutsideBand)

  return drifted.length === 0
    ? omitted('drift-nudge')
    : ready(
        'drift-nudge',
        drifted.map((row) => ({
          segment: row.segment,
          currentPctNav: row.currentPctNav,
          targetPctNav: row.targetPctNav,
        }))
      )
}

/** Once per calendar month per user, where "once" counts deliveries rather than briefs: a month
 *  whose first brief had nothing resolved must still deliver one later. */
export async function buildMonthlyScorecard(context: BriefContext): Promise<BriefSectionResult> {
  if (context.request.scorecardShownThisMonth) {
    return omitted('monthly-scorecard')
  }

  // The scored window, not a row cap: this section renders one row whatever the sample size, and
  // reading it through the per-section display limit would score the last few rows as the record.
  const report = await context.services.summarize({
    limit: SURFACE_LIMITS.maximumTrackRecordItems,
    signal: context.request.signal,
  })
  const { summary } = report

  if (summary.resolvedCount === 0) {
    return omitted('monthly-scorecard')
  }

  return ready(
    'monthly-scorecard',
    [
      {
        resolvedCount: summary.resolvedCount,
        pendingCount: summary.coverage.pending,
        ...(summary.winRate === undefined ? {} : { winRate: summary.winRate }),
      },
    ],
    { caveats: summary.caveats }
  )
}

/** What this brief cost, from its own slice. */
export function buildCost(context: BriefContext): Promise<BriefSectionResult> {
  const { budget } = context.request

  // A brief that debates nothing would otherwise report zero every morning.
  if (budget.spentUsd === 0) {
    return Promise.resolve(omitted('cost'))
  }

  // An uncapped limit is Infinity, which JSON stores as `null` and the row schema rejects on read,
  // leaving a snapshot that renders once and never again. Absent is how a renderer reads "no cap".
  return Promise.resolve(
    ready('cost', [
      {
        spentUsd: budget.spentUsd,
        ...(Number.isFinite(budget.limitUsd) ? { limitUsd: budget.limitUsd } : {}),
      },
    ])
  )
}

/** The single most expensive section. It runs last among the producing sections and draws from the
 *  brief's own budget slice, so an exhausted budget costs this section and nothing else. */
export async function buildSuggestions(context: BriefContext): Promise<BriefSectionResult> {
  const cross = context.cross

  if (context.suggestionNames.length === 0) {
    return omitted('suggestions')
  }

  if (cross === null) {
    return absent('suggestions', [{ code: 'market-data.no-coverage' }])
  }

  const results = await runBatch(context, context.suggestionNames)

  return summarizeRuns('suggestions', results)
}

export async function buildCrossAssetSuggestions(
  context: BriefContext
): Promise<BriefSectionResult> {
  if (context.crossAssetSuggestionNames.length === 0) {
    return omitted('cross-asset-suggestions')
  }

  return summarizeRuns(
    'cross-asset-suggestions',
    await runBatch(context, context.crossAssetSuggestionNames)
  )
}

function sinceOptions(context: BriefContext): ListSinceOptions {
  return {
    since: context.request.activitySince,
    limit: context.policy.maximumItemsPerSection,
    signal: context.request.signal,
  }
}

/** A segment that has not moved from its target has not drifted, whatever band it carries. A
 *  switched-off segment sits at nothing against a target of nothing under a band of nothing, which a
 *  bare `>=` reports as drifted — and the brief nudged about a segment the operator had closed. */
function isOutsideBand(row: SegmentTarget): boolean {
  const drift = Math.abs(row.currentPctNav - row.targetPctNav)

  return drift > 0 && drift >= row.driftBandPctNav
}

async function runBatch(
  context: BriefContext,
  instruments: readonly InstrumentRef[]
): Promise<readonly SuggestionRunResult[]> {
  const results = await context.services.runSuggestions({
    items: instruments.map((instrument) => ({
      locale: context.request.locale,
      ticker: instrument.ticker,
      market: instrument.market,
      asOf: { kind: 'day', day: context.request.asOf },
    })),
    channel: context.request.channel,
    billingSessionId: context.request.billingSessionId,
    ...(context.request.parentRunId === undefined
      ? {}
      : { parentRunId: context.request.parentRunId }),
    budget: context.request.budget,
    debateMode: BRIEF_DEBATE_MODE,
    now: context.request.now,
    signal: context.request.signal,
    ...(context.request.progress === undefined ? {} : { progress: context.request.progress }),
  })

  return results
}

function summarizeRuns(
  kind: BriefSectionKind,
  results: readonly SuggestionRunResult[]
): BriefSectionResult {
  const completed = results.filter((result) => result.kind === 'completed')

  return completed.length === 0
    ? absent(kind, [{ code: 'market-data.no-coverage' }])
    : ready(
        kind,
        completed.map((result) => toCallRow(result.suggestion)),
        {
          provenance: completed.flatMap((result) => result.suggestion.provenance),
          caveats: outdatedCallCaveats(completed.map((result) => result.suggestion)),
        }
      )
}

/** The row prints only the action, so a call the book has moved past since says so here, or the
 *  brief would restate an order the operator's own trade or deposit already changed. */
function outdatedCallCaveats(suggestions: readonly StoredSuggestion[]): readonly Caveat[] {
  return suggestions
    .filter((suggestion) => suggestion.caveats.some((caveat) => BOOK_MOVED_CODES.has(caveat.code)))
    .map((suggestion) => ({
      code: 'brief.call-outdated',
      detail: { ticker: suggestion.instrument.ticker },
    }))
}

/** A run whose debate never answered decided nothing, so it carries neither an action nor a
 *  conviction to print. */
function toCallRow(suggestion: StoredSuggestion): BriefSectionRow {
  const ticker = suggestion.instrument.ticker

  if (isInconclusive(suggestion)) {
    return { ticker, action: 'inconclusive' }
  }

  return {
    ticker,
    action: suggestion.action,
    conviction: suggestion.conviction,
    ...(suggestion.action === 'reduce' && suggestion.reduceReasonCode !== undefined
      ? { reduceReason: suggestion.reduceReasonCode }
      : {}),
  }
}
