import type { BrandTag } from '@/core/ids'
import { ValidationError } from '@/core/errors'

const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
const TRADING_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Three letters is ISO 4217; the fourth admits a settlement token a market actually quotes in, so
 *  `USDT` can be a currency without every other code loosening. */
const CURRENCY_RE = /^[A-Z]{3,4}$/
export const FIAT_CODE_LENGTH = 3
const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/
const STRATEGY_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** Eight decimals is what a spot lot or tick size is ever quoted to, and step arithmetic needs a
 *  precision to settle on. */
export const STEP_DIGITS = 8

export type Ticker = string & BrandTag<'Ticker'>
export type TradingDay = string & BrandTag<'TradingDay'>
export type CurrencyCode = string & BrandTag<'CurrencyCode'>
export type MarketRef = string & BrandTag<'MarketRef'>
export type VenueRef = string & BrandTag<'VenueRef'>
export type StrategyId = string & BrandTag<'StrategyId'>
export type Region = string & BrandTag<'Region'>
export type PortfolioSegment = string & BrandTag<'PortfolioSegment'>
export type QuoteUnit = string & BrandTag<'QuoteUnit'>

export type AssetClass = 'equity' | 'gold' | 'crypto'

export const INSTRUMENT_KINDS = Object.freeze([
  'equity',
  'etf',
  'future',
  'index',
  'gold',
  'fx',
  'crypto',
] as const)
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number]

/** The one kind a sleeve puts its own ceiling on, so the fold that measures it, the ceilings that
 *  bind it and the row that names it all compare against one spelling. */
export const ETF_KIND: InstrumentKind = 'etf'

/** The kinds that publish a level rather than a price: no board scale to divide by and no currency
 *  to name. A futures contract on an index quotes the same points its underlying does, so leaving it
 *  out divided VN30F1M by the VN board scale and printed 1.937,60 as `1,94 VND`. */
const LEVEL_KINDS = Object.freeze(['index', 'future'] as const satisfies readonly InstrumentKind[])
/** Not exported: every consumer narrows through `isLevelKind` and none names the type. */
type LevelKind = (typeof LEVEL_KINDS)[number]

export function isLevelKind(kind: InstrumentKind | undefined): kind is LevelKind {
  return LEVEL_KINDS.some((level) => level === kind)
}

/** Which kinds each market's universe screen may be narrowed to, keyed by market — the registry's
 *  view of every manifest's `screenableKinds`. Markets that declare none are absent. */
export type ScreenableKinds = ReadonlyMap<MarketRef, readonly InstrumentKind[]>

/** The one rendering of that map, shared by the tool description and the `/screen` usage line so a
 *  caller reads the same list wherever it is asked. */
export function screenableKindsText(screenableKinds: ScreenableKinds): string {
  return [...screenableKinds].map(([market, kinds]) => `${market} (${kinds.join(', ')})`).join('; ')
}

/** Every kind some registered market screens by, deduped: what a surface may offer as a slot. */
export function screenableKindList(screenableKinds: ScreenableKinds): readonly InstrumentKind[] {
  return [...new Set([...screenableKinds.values()].flat())]
}

export const SEGMENT_CATEGORIES = Object.freeze(['stock', 'etf', 'gold', 'crypto', 'cash'] as const)
type SegmentCategory = (typeof SEGMENT_CATEGORIES)[number]

export type PositionCategory = Exclude<SegmentCategory, 'cash'>

export const POSITION_CATEGORIES: readonly PositionCategory[] = Object.freeze(
  SEGMENT_CATEGORIES.filter((category): category is PositionCategory => category !== 'cash')
)

export const VN_GOLD_FORMS = Object.freeze(['sjc-bar', 'pnj-ring', 'doji-ring'] as const)
export type VnGoldForm = (typeof VN_GOLD_FORMS)[number]

/** Narrowest first: VN30 is a strict subset of VN100, so a name in both is stamped `vn30`. */
export const VN_INDEX_TIERS = Object.freeze(['vn30', 'vn100'] as const)
export type VnIndexTier = (typeof VN_INDEX_TIERS)[number]

export const TRADING_SESSION_STATES = Object.freeze([
  'closed',
  'pre-open',
  'open',
  'post-close',
] as const)
export type TradingSessionState = (typeof TRADING_SESSION_STATES)[number]

/** The state above resolved against the calendar's trading days, which is what a reader can be
 *  shown: `closed` covers both a lunch break and a holiday, and only one of those is worth the
 *  word. Lives beside its sibling so the two session vocabularies are read together. */
export const SESSION_PHASES = Object.freeze([
  'pre-open',
  'open',
  'break',
  'post-close',
  'non-session',
] as const)
export type SessionPhase = (typeof SESSION_PHASES)[number]

export interface InstrumentRef {
  readonly market: MarketRef
  readonly ticker: Ticker
}

export interface InstrumentSearchRequest {
  readonly query: string
  readonly limit: number
  readonly signal: AbortSignal
}

/** One answer to a ticker or company-name search. */
export interface InstrumentMatch {
  readonly instrument: InstrumentRef
  readonly name?: string
  readonly instrumentKind?: InstrumentKind
}

export type InstrumentSearch = (
  options: InstrumentSearchRequest
) => Promise<readonly InstrumentMatch[]>

/** A name as the operator typed it: the ticker, and the market qualifying it where a bare one could
 *  be claimed by two. Resolution turns it into an `InstrumentRef`. */
export interface TickerRequest {
  readonly ticker: Ticker
  readonly market?: MarketRef
}

/** The same shape qualified by the custodian instead of the market: `okx:BTC`. Routing turns it
 *  into exactly one venue where none was named. */
export interface VenueTickerRequest {
  readonly ticker: Ticker
  readonly venue?: VenueRef
}

/** Instrument identity, everywhere. Two refs name the same instrument when market and ticker
 *  agree; nothing else on a ref participates. */
export function isSameInstrument(left: InstrumentRef, right: InstrumentRef): boolean {
  return left.market === right.market && left.ticker === right.ticker
}

export interface BoardLotPolicy {
  readonly size: number
}

/** The largest whole number of lots `units` covers, in units. Zero where it does not cover one —
 *  a quantity the venue cannot accept, which every caller must treat as nothing rather than round
 *  up to a lot the sizing never budgeted for. Takes the size rather than the policy: a fold carries
 *  the number alone, and one shape serves both it and a manifest holder. */
export function floorToLot(units: number, lotSize: number): number {
  return lotSize > 0 ? roundToStep(units, lotSize, 'down') : 0
}

/** Floating-point steps are decimal strings at the exchange, so the division is settled at the
 *  step's own precision before the directional round — 0.3 / 0.1 is 2.9999999999999996 otherwise. */
export function roundToStep(value: number, step: number, direction: 'down' | 'up'): number {
  const exact = Number((value / step).toFixed(STEP_DIGITS))
  const steps = direction === 'down' ? Math.floor(exact) : Math.ceil(exact)

  return Number((steps * step).toFixed(STEP_DIGITS))
}

interface TickBand {
  readonly maximumPriceExclusive?: number
  readonly tickSize: number
}

export interface TickSizePolicy {
  readonly bands: readonly TickBand[]
}

export interface DailyPriceBandPolicy {
  readonly maximumUpPct: number
  readonly maximumDownPct: number
}

/** The band as the venue quotes it: the policy's percentages resolved against the day's reference
 *  and snapped inward to the tick grid. Carried rather than re-derived, because the raw percentage
 *  edges fall up to a tick outside the grid and would accept a price the venue rejects. */
export interface DailyPriceBand {
  readonly floor: number
  readonly ceiling: number
  readonly policy: DailyPriceBandPolicy
}

/** How a venue prints a price on its board, when that differs from the stored currency amount. */
export interface PriceDisplay {
  readonly divisor: number
  readonly decimals: number
}

interface BrandFromPatternOptions {
  readonly label: string
  readonly canonicalize?: (raw: string) => string
}

export function brandFromPattern<T extends string>(
  raw: string,
  re: RegExp,
  options: BrandFromPatternOptions
): T {
  const canonical = options.canonicalize ? options.canonicalize(raw) : raw

  if (!re.test(canonical)) {
    throw new ValidationError(`invalid ${options.label}: ${raw}`)
  }

  // why-safe: `re` is this brand's only invariant and it just passed.
  return canonical as T
}

export function ticker(raw: string): Ticker {
  return brandFromPattern<Ticker>(raw, TICKER_RE, {
    label: 'ticker',
    canonicalize: (value) => value.trim().toUpperCase(),
  })
}

export function tradingDay(raw: string): TradingDay {
  const canonical = brandFromPattern<TradingDay>(raw, TRADING_DAY_RE, { label: 'trading day' })

  if (!isRealCalendarDay(canonical)) {
    throw new ValidationError(`invalid trading day: ${raw}`)
  }

  return canonical
}

/** Tests the value as stored, without canonicalizing: a caller holding a persisted code needs to
 *  know whether it is usable, not to repair it. */
export function isCurrencyCode(raw: string): raw is CurrencyCode {
  return CURRENCY_RE.test(raw)
}

export function currencyCode(raw: string): CurrencyCode {
  return brandFromPattern<CurrencyCode>(raw, CURRENCY_RE, {
    label: 'currency code',
    canonicalize: (value) => value.trim().toUpperCase(),
  })
}

/** The market-less symbol an FX source addresses, built from the two codes rather than written as
 *  a literal in each market that needs one. */
export function fxPair(from: CurrencyCode, to: CurrencyCode): Ticker {
  return ticker(`${from}${to}`)
}

/** The fiat FX providers cover a pair of two ISO codes and nothing else, so this also answers
 *  whether a pair has a provider that quotes it directly. */
export function isFiatCurrency(code: CurrencyCode): boolean {
  return code.length === FIAT_CODE_LENGTH
}

export function marketRef(raw: string): MarketRef {
  return brandFromPattern<MarketRef>(raw, SLUG_RE, {
    label: 'market ref',
    canonicalize: canonicalizeSlug,
  })
}

export function venueRef(raw: string): VenueRef {
  return brandFromPattern<VenueRef>(raw, SLUG_RE, {
    label: 'venue ref',
    canonicalize: canonicalizeSlug,
  })
}

function canonicalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

/** The same test the brand constructors apply, for a config key that must be rejected rather than
 *  thrown on. Two predicates over one pattern because the brands are distinct: a caller asking
 *  about a market must not read as asking about a venue. Whether the ref names a *registered*
 *  market or venue is only knowable at composition. */
export function isMarketRefShape(raw: string): boolean {
  return isSlugRef(raw)
}

export function isVenueRefShape(raw: string): boolean {
  return isSlugRef(raw)
}

/** Against the canonical form, because `ticker` upper-cases what it is handed and a config value
 *  written in lower case is the same name. */
export function isTickerShape(raw: string): boolean {
  return TICKER_RE.test(raw.trim().toUpperCase())
}

function isSlugRef(raw: string): boolean {
  return SLUG_RE.test(raw)
}

export function strategyId(raw: string): StrategyId {
  return brandFromPattern<StrategyId>(raw, STRATEGY_ID_RE, { label: 'strategy id' })
}

export function region(raw: string): Region {
  return brandFromPattern<Region>(raw, SLUG_RE, { label: 'region' })
}

export function portfolioSegment(raw: string): PortfolioSegment {
  return brandFromPattern<PortfolioSegment>(raw, SLUG_RE, { label: 'portfolio segment' })
}

export const CASH_SEGMENT: PortfolioSegment = portfolioSegment('cash')

export function quoteUnit(raw: string): QuoteUnit {
  return brandFromPattern<QuoteUnit>(raw, SLUG_RE, { label: 'quote unit' })
}

export function parseUuidV7Id<T extends string>(raw: string, label: string): T {
  if (!UUID_V7_RE.test(raw)) {
    throw new ValidationError(`invalid ${label}: ${raw}`)
  }

  // why-safe: this is the single mint point for every v7 row-id brand, and the layout check is
  // each one's only invariant.
  return raw as T
}

export function buildUuidV7Id<T extends string>(now: number, label: string): T {
  return parseUuidV7Id<T>(Bun.randomUUIDv7(undefined, now), label)
}

export function buildInstrumentKey(ref: InstrumentRef): string {
  return `${ref.market}:${ref.ticker}`
}

/** A holding's identity: the same coin at two custodians is two positions, so a sale on one
 *  releases that venue's basis rather than an average including coins still held elsewhere.
 *  `buildInstrumentKey` stays for callers that group by instrument regardless of custodian. */
export function buildPositionKey(instrument: InstrumentRef, venue: VenueRef): string {
  return `${venue}:${buildInstrumentKey(instrument)}`
}

/** First occurrence wins, so a configured ordering survives deduplication. */
export function dedupeInstruments(refs: readonly InstrumentRef[]): readonly InstrumentRef[] {
  const seen = new Set<string>()

  return refs.filter((ref) => {
    const key = buildInstrumentKey(ref)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function isRealCalendarDay(raw: string): boolean {
  const parsed = new Date(`${raw}T00:00:00.000Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw
}
