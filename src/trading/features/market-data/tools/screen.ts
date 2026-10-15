import type { DisplayText } from '@/core/stream-events'
import type { ToolDefinition, ToolResult } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type {
  MarketDataService,
  ScreenedCandidate,
  ScreenView,
} from '@/trading/features/market-data/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorId } from '@/trading/kernel/factor'
import type { CurrencyCode, MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { ScreenCandidate, ScreenResult } from '@/trading/kernel/market/market-capability'
import type { AgentFocus } from '@/trading/kernel/operator/focus'
import type { AgentWriter, PriceWriter } from '@/trading/kernel/surface/agent-json'
import type { MarketSchema } from '@/trading/kernel/surface/surface'
import { createTool } from '@/core/tool'
import { pluralKey, t } from '@/i18n'
import { rootAgentFocus } from '@/trading/kernel/operator/focus'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { screenInput } from '@/trading/kernel/surface/surface'
import { boardMedians, byDistinctiveness } from '@/trading/markets/factor-scoring'
import { countByGate, type GateCounts } from '@/trading/markets/screen-partition'
import { screenRating } from '@/trading/markets/screen-rating'
import { renderFocusLabel } from '@/trading/render/focus'
import { renderProvidedValue, renderScoreBand } from '@/trading/render/format'
import { formatScaledPrice } from '@/trading/render/money'
import { renderMarketName } from '@/trading/render/tool-detail'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** Enough tickers to show what surfaced without wrapping the line; the rest is a count. */
const SUMMARY_TICKER_COUNT = 8
/** The evidence a model needs to compare two candidates; the full set is what `/screen` renders. */
const PAYLOAD_FACTOR_COUNT = 3

interface PayloadFactor {
  readonly id: FactorId
  /** The catalog's own name for the factor: a model handed only the id translates it itself, and
   *  an invented name is a different claim than the one the factor measures. */
  readonly name: string
  readonly band: string
}

interface PayloadCandidate {
  readonly ticker: Ticker
  readonly rating: string
  readonly factors: readonly PayloadFactor[]
  /** Absent only when the quote failed; that name is described by rank alone. */
  readonly price?: string
  readonly changePct?: number
  /** `live` while the market trades, `close` once it has settled — the same number means a
   *  different thing, so say which before quoting it. */
  readonly priceKind?: 'live' | 'close'
  /** The close the rank was built on, with the session it settled. Absent while `price` is that
   *  same close, so the two never restate one reading as two. */
  readonly previousClose?: string
  readonly previousCloseDay?: TradingDay
  /** Present when the live price contradicts the settled rank rather than merely updating it, in
   *  which case `rating` has already been lowered. */
  readonly caution?: string
  /** The operator excluded this name; the suggestion pipeline will refuse it. */
  readonly excluded?: true
  /** Off the exchange's margin list; the suggestion pipeline will say so too. */
  readonly marginIneligible?: true
}

interface ScreenPayload {
  readonly asOf: TradingDay
  readonly dataThroughDay?: TradingDay
  readonly market: MarketRef
  readonly currency?: CurrencyCode
  readonly timezone?: string
  readonly universeSize: number
  readonly candidates: readonly PayloadCandidate[]
  readonly rejectedByGate: GateCounts
  readonly caveats: readonly Caveat[]
}

export function createMarketScreenTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_screen',
    description:
      'Deterministically rank buy candidates across the whole tradable universe of one market by its factor model - the discovery path for open-ended "what should I buy" when no ticker is named. No LLM. Candidates are pre-ranked best-first. Each candidate carries a `rating` (e.g. "Strong Buy", "Buy", "Hold", "Avoid", "Strong Avoid", or "Inconclusive" when coverage is thin) and its top factors carry a `band` (e.g. "Very bullish", "Bearish", "Neutral") - describe them in plain language using these labels, never quote a raw score. This board is the whole answer to an open-ended ask: present it, name the option of deepening one, and stop. Present it as a markdown table, one row per candidate in the order given and never reordered, with a column each for the ticker, its `rating`, its top factor names and their bands, `price`, and `changePct` - never a bulleted list, a heading per name, or prose. Write like a calm senior analyst: friendly, plain, easy to read; never add your own "Đánh giá" line, the `rating` is the verdict; add one short sentence on what the board means, then offer to deepen one name. Header and every cell go in the language the operator is using; a candidate carrying no `price` gets an empty cell rather than a dropped row. Never deepen on your own - suggestion_run and suggestion_batch belong to a later turn, on names the operator picks. The ranking is built on the settled session `dataThroughDay` (falling back to `asOf`), a day of the `timezone` clock - a crypto board is dated by the UTC day, so name the clock rather than the operator\'s. A candidate\'s `price` arrives written in its market\'s own convention - a board-scaled price names its scale in brackets, so put that scale once in the column header and the bare number in each cell - and `priceKind` says what that number is: `live` while the market trades, `close` once it has settled. Call a `close` the closing price, never the current one, and state both freshnesses without blending them; a candidate carrying no `price` is described by its bands alone. When `previousClose` is present the candidate carries two prices - `previousClose` is the `previousCloseDay` close the rank was built on and `price` is the live reading beside it - so give the table a column for each and label them that way, never averaging or replacing one with the other. A candidate may also carry `caution`: the live price contradicts the settled rank behind it, so its `rating` has already been lowered to a hold - print that `caution` text in the row and never argue the rank back up. A candidate carrying `excluded` is on the operator\'s exclusion list: report it as excluded and never open a suggestion_run on it, which would refuse. A candidate carrying `marginIneligible` is off the exchange\'s margin list: say so in the row, because a broker will not lend against it and that list is where every name under exchange supervision lands.',
    inputSchema: screenInput({ markets, screenableKinds: marketData.screenableKinds() }),
    capability: 'net',
    eager: true,
    presentation: {
      label: 'Screen',
      emoji: '🔬',
      detail: (input, locale) => renderMarketName(locale, input.market),
    },
    async execute(args, ctx): Promise<ToolResult> {
      const now = Date.now()
      const focus = rootAgentFocus(ctx).focus.focus
      const quoted = marketData.quoteConvention(args.market) ?? {}
      const price: PriceWriter = (value) => formatScaledPrice(ctx.locale, value, quoted)

      if (focus?.markets !== undefined && !focus.markets.includes(args.market)) {
        return outsideFocusRefusal(ctx.locale, focus, args.market)
      }

      const screened = await marketData.screen({
        market: args.market,
        limit: args.limit ?? SURFACE_LIMITS.defaultScreenCandidates,
        now,
        signal: ctx.signal,
        ...(args.instrumentKind === undefined ? {} : { instrumentKind: args.instrumentKind }),
        ...(focus?.sectors === undefined ? {} : { sectors: focus.sectors }),
      })
      const noMatch = await focusNoMatchCaveats(marketData, {
        focus,
        result: screened,
        market: args.market,
        now,
        locale: ctx.locale,
        signal: ctx.signal,
      })
      const result = { ...screened, caveats: [...screened.caveats, ...noMatch] }

      return {
        content: toAgentJson(screenPayload(result, args.market, { locale: ctx.locale, price })),
        isError: false,
        display: screenDisplay(result),
      }
    },
  })
}

function outsideFocusRefusal(locale: Locale, focus: AgentFocus, market: MarketRef): ToolResult {
  return {
    content: t(locale, 'trading.screen.outside-focus', {
      focus: renderFocusLabel(locale, focus),
      market: renderMarketName(locale, market),
    }),
    isError: true,
  }
}

interface FocusNoMatchInput {
  readonly focus: AgentFocus | undefined
  readonly result: ScreenView
  readonly market: MarketRef
  readonly now: number
  readonly locale: Locale
  readonly signal: AbortSignal
}

/** An empty board under a sector focus is most often a sector filed under another name, so the
 *  market's own list is what the agent needs next. Read only then: the list costs a query. */
async function focusNoMatchCaveats(
  marketData: MarketDataService,
  input: FocusNoMatchInput
): Promise<readonly Caveat[]> {
  const { focus, result, locale } = input

  if (focus?.sectors === undefined || result.candidates.length > 0) {
    return []
  }

  const board = await marketData.sectors({
    market: input.market,
    now: input.now,
    signal: input.signal,
  })

  if (board.sectors.length === 0) {
    return []
  }

  const label = (slug: string): string =>
    renderProvidedValue(locale, `trading.sector.${slug}`, slug)

  return [
    {
      code: 'market-data.focus-no-match',
      detail: {
        sectors: focus.sectors.map(label).join(', '),
        known: board.sectors.map((entry) => label(entry.sector)).join(', '),
      },
    },
  ]
}

/** A universe screen rejects hundreds of names and stamps provenance per name, which is an order of
 *  magnitude past the history cap that trims a tool result to a head-tail window. The model needs
 *  the ranked head and the shape of what was dropped; the operator gets the rest from `/screen`. */
function screenPayload(result: ScreenView, market: MarketRef, writer: AgentWriter): ScreenPayload {
  const medians = boardMedians(result.candidates.map((candidate) => candidate.factors))

  return {
    asOf: result.asOf,
    ...(result.dataThroughDay === undefined ? {} : { dataThroughDay: result.dataThroughDay }),
    market,
    ...(result.currency === undefined ? {} : { currency: result.currency }),
    ...(result.timezone === undefined ? {} : { timezone: result.timezone }),
    universeSize: result.universeSize,
    candidates: result.candidates.map((candidate) =>
      toPayloadCandidate(candidate, writer, medians)
    ),
    rejectedByGate: countByGate(result.rejections),
    caveats: result.caveats,
  }
}

/** The same factors `/screen` prints for this name: the ones furthest from what the board reads,
 *  which is what makes them the answer to "why is this one here". */
function toPayloadCandidate(
  candidate: ScreenedCandidate,
  writer: AgentWriter,
  medians: ReadonlyMap<FactorId, number>
): PayloadCandidate {
  const { locale } = writer

  return {
    ticker: candidate.instrument.ticker,
    rating: ratingLabel(locale, candidate),
    ...(candidate.excluded === undefined ? {} : { excluded: candidate.excluded }),
    ...(candidate.marginIneligible === undefined
      ? {}
      : { marginIneligible: candidate.marginIneligible }),
    ...(candidate.caution === undefined
      ? {}
      : { caution: t(locale, `trading.screen.caution.${candidate.caution}`) }),
    // A factor that read nothing is not what sets a name apart, and `/screen` never lists one.
    factors: byDistinctiveness(candidate.factors, medians)
      .filter((factor) => factor.score !== 0)
      .slice(0, PAYLOAD_FACTOR_COUNT)
      .map((factor) => ({
        id: factor.id,
        name: t(locale, `trading.factor.${factor.id}`),
        band: renderScoreBand(locale, factor.score),
      })),
    ...quoteFields(candidate, writer.price),
  }
}

interface PayloadQuote {
  readonly price?: string
  readonly changePct?: number
  readonly priceKind?: 'live' | 'close'
  readonly previousClose?: string
  readonly previousCloseDay?: TradingDay
  /** Present when the live price contradicts the settled rank rather than merely updating it, in
   *  which case `rating` has already been lowered. */
  readonly caution?: string
}

/** Separate fields from the rank: the two carry different freshnesses and must not blend. The
 *  settled close joins them only where `price` is a live tick — once the session has shut the quote
 *  is that close, and a second copy of it would read as a second reading. */
function quoteFields(candidate: ScreenCandidate, writePrice: PriceWriter): PayloadQuote {
  const { price, previousClose } = candidate
  const ranked =
    previousClose === undefined || price?.observed.kind === 'close'
      ? {}
      : { previousClose: writePrice(previousClose.price), previousCloseDay: previousClose.at }

  if (price === undefined) {
    return ranked
  }

  return {
    ...ranked,
    price: writePrice(price.quote.price),
    ...(price.quote.changePct === undefined ? {} : { changePct: price.quote.changePct }),
    priceKind: price.observed.kind,
  }
}

function ratingLabel(locale: Locale, candidate: ScreenCandidate): string {
  return t(locale, `trading.rating.${screenRating(candidate)}`)
}

/** Built from the result rather than through `summarizeResult`, which receives the post-pipeline
 *  string: a universe-wide screen carries a rejection per name it skipped, runs past the output
 *  cap, and the head-tail window left behind no longer parses as JSON. */
function screenDisplay(result: ScreenResult): DisplayText {
  // An empty universe and an all-rejected one both end with no candidates, and only the first is
  // the market's answer rather than the gates'.
  if (result.universeSize === 0) {
    return { key: 'toolSummaries.screenNoUniverse' }
  }

  if (result.candidates.length === 0) {
    return { key: 'toolSummaries.screenNoCandidates' }
  }

  const tickers = result.candidates.map((candidate) => candidate.instrument.ticker)
  const shown = tickers.slice(0, SUMMARY_TICKER_COUNT).join(', ')
  const hidden = tickers.length - SUMMARY_TICKER_COUNT

  return {
    key: pluralKey(
      tickers.length,
      'toolSummaries.screenCandidatesOne',
      'toolSummaries.screenCandidates'
    ),
    params: { count: tickers.length, tickers: hidden > 0 ? `${shown} +${hidden}` : shown },
  }
}
