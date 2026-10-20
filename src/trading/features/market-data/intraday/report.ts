import type { Locale } from '@/core/types/locale'
import type { IntradayPlan } from '@/trading/features/market-data/intraday/schedule'
import type {
  IntradayMarketContext,
  IntradayReport,
  IntradayRow,
} from '@/trading/features/market-data/intraday/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  PreviousClose,
  QuoteBoard,
  QuoteBoardItem,
} from '@/trading/kernel/market/market-capability'
import type { QuoteFreshness } from '@/trading/kernel/market/market-data'
import type {
  MarketDataOverview,
  MarketDataOverviewRow,
} from '@/trading/kernel/market/market-overview'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { TradingCalendar } from '@/trading/markets/types'
import type { QuoteConvention } from '@/trading/render/money'
import { toSettled } from '@/trading/features/market-data/intraday/settled'
import { INTRADAY_CONTEXT_KINDS } from '@/trading/features/market-data/intraday/types'
import { buildInstrumentKey, dedupeInstruments, isLevelKind } from '@/trading/kernel/instrument'
import { sessionPhase } from '@/trading/markets/calendar'
import { overviewSections } from '@/trading/markets/overview-sections'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** Each list is capped separately so one long book cannot crowd the other out of the message. */
const MAXIMUM_ROWS_PER_LIST = 6
const MAXIMUM_CAVEATS = 2
/** How far above the settled close a session has to have traded for giving it all back to read as
 *  a failed gap rather than an ordinary open. */
const FAILED_GAP_FRACTION = 0.02

interface IntradayMarketReader {
  quoteBoard(options: {
    readonly instruments: readonly InstrumentRef[]
    readonly signal: AbortSignal
  }): Promise<QuoteBoard>
  overview(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<readonly MarketDataOverview[]>
  /** How a market quotes a price. Read here so every row carries its own convention into an
   *  unattended delivery, where the renderer has no registry to ask. */
  quoteConvention(market: MarketRef): QuoteConvention | undefined
}

/** Narrowed to what the row list needs: which name, and how much of the book stands behind it. */
interface HeldPosition {
  readonly instrument: InstrumentRef
  readonly costBasisBase: number
}

interface IntradayBookReader {
  tradeableHoldingsAt(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<readonly HeldPosition[]>
}

/** The watchlist, read through the profile that owns it. Narrowed to the one field this report
 *  needs, so the reader cannot reach the operator's limits. */
interface IntradayWatchlistReader {
  get(options: {
    readonly defaultLocale: Locale
    readonly signal: AbortSignal
  }): Promise<{ readonly watchlist: readonly InstrumentRef[] }>
}

export interface IntradayReportDeps {
  readonly marketData: IntradayMarketReader
  readonly book: IntradayBookReader
  readonly profiles: IntradayWatchlistReader
  readonly locale: Locale
  /** `[locale] timezone`, the one clock every rendered instant reads in. */
  readonly timezone: string
}

interface BuildIntradayReportOptions {
  readonly plan: IntradayPlan
  readonly now: number
  readonly signal: AbortSignal
}

/** One clock read for the whole report: rows stamped from separate reads can disagree about the
 *  trading day at a session boundary. */
export async function buildIntradayReport(
  deps: IntradayReportDeps,
  options: BuildIntradayReportOptions
): Promise<IntradayReport> {
  const { plan, now, signal } = options
  const calendar = plan.market.manifest.calendar
  const [positions, profile] = await Promise.all([
    deps.book.tradeableHoldingsAt({ now, signal }),
    deps.profiles.get({ defaultLocale: deps.locale, signal }),
  ])
  const held = heldByBasis(positions)
  const watched = dedupeInstruments(profile.watchlist)
  const scoped = [
    ...held.slice(0, MAXIMUM_ROWS_PER_LIST),
    ...watched.slice(0, MAXIMUM_ROWS_PER_LIST),
  ]
  const [quoteBoard, overviews] = await Promise.all([
    deps.marketData.quoteBoard({
      instruments: scoped.slice(0, SURFACE_LIMITS.maximumQuoteBoardItems),
      signal,
    }),
    deps.marketData.overview({ now, signal }),
  ])
  const overview = findOverview(overviews, plan.market.manifest.id)
  const settled = overview === undefined ? undefined : toSettled(overview)
  // Against the settled block's own day, never `resolveSettledDay`: the calendar flips to today at
  // the close while the overview keeps reporting yesterday until the refresh stores today.
  const sessionForming = settled !== undefined && settled.day !== calendar.dayAt(now)

  return {
    market: plan.market.manifest.id,
    icon: plan.market.manifest.icon,
    phase: sessionPhase(calendar, now),
    firedAt: now,
    indexes: indexRows(overview, { calendar, timezone: deps.timezone }),
    positions: rowsFor(deps, quoteBoard, held),
    positionsOverflow: Math.max(0, held.length - MAXIMUM_ROWS_PER_LIST),
    watchlist: rowsFor(deps, quoteBoard, watched),
    watchlistOverflow: Math.max(0, watched.length - MAXIMUM_ROWS_PER_LIST),
    ...(overview?.intraday === undefined ? {} : { session: overview.intraday }),
    ...(settled === undefined ? {} : { settled }),
    contexts: contextsFor(overviews, scoped, plan.market.manifest.id),
    sessionForming,
    caveats: caveatsOf(quoteBoard, overview, sessionForming),
  }
}

/** Largest first, by the basis the book carries for the name. The row budget is small enough that
 *  a book's residue — the slivers a full exit leaves behind — otherwise takes rows from the
 *  positions the operator can act on, purely because it was recorded earlier. Folded per instrument
 *  rather than per position, because a name held at two venues is one row here. */
function heldByBasis(positions: readonly HeldPosition[]): readonly InstrumentRef[] {
  const basis = new Map<string, number>()

  for (const position of positions) {
    const key = buildInstrumentKey(position.instrument)

    basis.set(key, (basis.get(key) ?? 0) + position.costBasisBase)
  }

  return dedupeInstruments(positions.map((position) => position.instrument)).toSorted(
    (left, right) =>
      (basis.get(buildInstrumentKey(right)) ?? 0) - (basis.get(buildInstrumentKey(left)) ?? 0)
  )
}

/** No board convention and no currency of its own on an index row: a divisor scales a share price
 *  into board points, and an index level is already a level. `priceCurrency` is what the rows are
 *  quoted in where they are money at all, and a market publishing levels declares none — reading
 *  the market's own `currency` here labels VN-Index in đồng. */
function indexRows(
  overview: MarketDataOverview | undefined,
  clock: { readonly calendar: TradingCalendar; readonly timezone: string }
): readonly IntradayRow[] {
  if (overview === undefined) {
    return []
  }

  return [...overview.rows]
    .sort((left, right) => (right.turnover ?? 0) - (left.turnover ?? 0))
    .map((row) => ({
      ticker: row.instrument.ticker,
      market: overview.market,
      ...(overview.priceCurrency === undefined ? {} : { currency: overview.priceCurrency }),
      observed: indexFreshness(row, overview.asOf, clock),
      ...indexReading(row),
      ...(row.live?.session === undefined ? {} : { session: row.live.session }),
      ...settledClose(row),
    }))
}

/** `MarketDataOverviewRow.live` is present only while the reading is fresher than the settled
 *  close, so its absence is what stamps a row as that close rather than as current. A settled row
 *  is dated to its own session's close, the same instant a stored bar is observed at — `closedOn`
 *  rather than the block's `asOf`, which names the settled tape and trails an index row whose
 *  endpoint has already published today. */
function indexFreshness(
  row: MarketDataOverviewRow,
  asOf: TradingDay,
  source: { readonly calendar: TradingCalendar; readonly timezone: string }
): QuoteFreshness {
  const closedOn = row.closedOn ?? asOf
  const observedAt = row.live?.observedAt ?? source.calendar.sessionCloseAt(closedOn)

  // A live reading belongs to the session it was taken in; dating it to the settled day would print
  // today's price under yesterday's date.
  return row.live === undefined
    ? { kind: 'close', day: closedOn, observedAt }
    : { kind: 'live', day: source.calendar.dayAt(observedAt), observedAt }
}

/** The close carries what its own session moved. `changePct` is that move, and the live reading's
 *  change replaces it downstream — so a settled row that did not take it here reports no day move
 *  at all once the session's own bar is stored. */
function settledClose(row: MarketDataOverviewRow): { previousClose?: PreviousClose } {
  if (row.quote === undefined || row.closedOn === undefined) {
    return {}
  }

  return {
    previousClose: {
      price: row.quote.price,
      at: row.closedOn,
      ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
    },
  }
}

function indexReading(row: MarketDataOverviewRow): Pick<IntradayRow, 'price' | 'changePct'> {
  const price = row.live?.price ?? row.quote?.price
  const changePct = row.live === undefined ? row.changePct : row.live.changePct

  return {
    ...(price === undefined ? {} : { price }),
    ...(changePct === undefined ? {} : { changePct }),
  }
}

/** A row per requested instrument, in request order, so a name whose quote failed keeps its place
 *  and renders as unpriced rather than vanishing and reflowing the block. */
function rowsFor(
  deps: IntradayReportDeps,
  quoteBoard: QuoteBoard,
  instruments: readonly InstrumentRef[]
): readonly IntradayRow[] {
  return instruments.slice(0, MAXIMUM_ROWS_PER_LIST).map((instrument) => {
    const item = quoteBoard.items.find(
      (candidate) =>
        candidate.ticker === instrument.ticker && candidate.market === instrument.market
    )

    if (item === undefined) {
      return { ticker: instrument.ticker, market: instrument.market }
    }

    return {
      ticker: item.ticker,
      market: item.market,
      price: item.last,
      observed: item.observed,
      ...(item.previousClose === undefined ? {} : { previousClose: item.previousClose }),
      ...quotedFieldsOf(deps, item),
      ...(item.changePct === undefined ? {} : { changePct: item.changePct }),
      ...(item.sessionVolume === undefined ? {} : { traded: item.sessionVolume > 0 }),
      ...(item.session === undefined ? {} : { session: item.session }),
      ...(isFailedGap(item) ? { gapFailed: true } : {}),
    }
  })
}

/** Live rows only: outside the session the provider answers with the previous range, and a settled
 *  close measured against itself reads as a gap that never happened. */
function isFailedGap(item: QuoteBoardItem): boolean {
  const close = item.previousClose?.price

  if (item.observed.kind !== 'live' || item.session === undefined || close === undefined) {
    return false
  }

  return item.session.high >= close * (1 + FAILED_GAP_FRACTION) && item.last <= close
}

/** Absent rather than `undefined`: `exactOptionalPropertyTypes` rejects forwarding an optional field
 *  any other way. A level carries neither — it has no currency and no board scale. */
function quotedFieldsOf(
  deps: IntradayReportDeps,
  item: QuoteBoardItem
): Pick<IntradayRow, 'currency' | 'display'> {
  if (isLevelKind(item.kind)) {
    return {}
  }

  const display = deps.marketData.quoteConvention(item.market)?.display

  return { currency: item.currency, ...(display === undefined ? {} : { display }) }
}

/** The markets this book touches beyond the one the report covers. Their overviews were already
 *  built by the same read, and a holder of them otherwise gets prices with nothing to read them
 *  against until they open `/overview`. */
function contextsFor(
  overviews: readonly MarketDataOverview[],
  scoped: readonly InstrumentRef[],
  reported: MarketRef
): readonly IntradayMarketContext[] {
  const markets = [...new Set(scoped.map((instrument) => instrument.market))]

  return markets.flatMap((market) => {
    const overview = market === reported ? undefined : findOverview(overviews, market)

    if (overview === undefined) {
      return []
    }

    const sections = overviewSections(overview).filter(isContextSection)

    return sections.length === 0 ? [] : [{ market, icon: overview.icon, sections }]
  })
}

function isContextSection(section: BriefSectionResult): boolean {
  return section.status === 'ready' && INTRADAY_CONTEXT_KINDS.some((kind) => kind === section.kind)
}

/** A report that renders the forming-session note says in its own words what the settled-evidence
 *  caveat says, so that caveat is dropped rather than printed under it. Every other surface carries
 *  it, because nothing else there states the gap. */
function caveatsOf(
  quoteBoard: QuoteBoard,
  overview: MarketDataOverview | undefined,
  sessionForming: boolean
): readonly Caveat[] {
  const caveats = [...quoteBoard.caveats, ...(overview?.caveats ?? [])]
  const kept = sessionForming
    ? caveats.filter((caveat) => caveat.code !== 'market-data.evidence-settled-only')
    : caveats

  return kept.slice(0, MAXIMUM_CAVEATS)
}

function findOverview(
  overviews: readonly MarketDataOverview[],
  market: MarketRef
): MarketDataOverview | undefined {
  return overviews.find((entry) => entry.market === market)
}
