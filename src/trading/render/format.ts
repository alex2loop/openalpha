import type { Locale } from '@/core/types/locale'
import type { CaveatSeverity } from '@/trading/kernel/caveat'
import type { WatchMark } from '@/trading/kernel/operator/brief-story'
import type { OrderSide } from '@/trading/kernel/venue/spot-adapter'
import { hasMessage, type MessageKey, t } from '@/i18n'
import { type ScoreBand, scoreBand } from '@/trading/markets/factor-scoring'
import {
  CRYPTO_SUBUNIT_DIGITS,
  FRACTION_QUANTUM,
  formatNumber,
  hasMagnitude,
} from '@/trading/render/number'

/** One marker per block a reader scans for. A concept the agent tools already show wears the same
 *  glyph as its `presentation.emoji`, so one thing never reads as two. Section identity only —
 *  status glyphs (success, error, warn) belong to the surface, which colors them and falls back to
 *  ASCII; these travel unchanged to a terminal and to a chat message. */
export const SECTION_ICONS = Object.freeze({
  themes: '🔭',
  suggestion: '💡',
  factors: '📶',
  debate: '💬',
  sources: '🔗',
  unverified: '❓',
  invalidators: '🚩',
  portfolio: '📊',
  profile: '🪪',
  segments: '🧭',
  positions: '💼',
  cash: '💰',
  pnl: '💹',
  watchlist: '👀',
  advice: '⚖️',
  reflect: '📈',
  acted: '🤝',
  calibration: '🎚️',
  breakdown: '🧪',
  outcomes: '🏁',
  screen: '🔬',
  macro: '🌐',
  overview: '🗺️',
  quote: '💵',
  ledger: '🧾',
  alert: '🔔',
  order: '🛒',
  upcoming: '📅',
  brief: '🌅',
  verdict: '📋',
  story: '📝',
  thesisReview: '⏪',
  session: '⏱️',
  settled: '📘',
  refresh: '🔄',
  reconcile: '🧮',
  thesis: '📌',
  plan: '🎯',
})

/** Whether a story's watch has been reached, on a row inside the review. Plain marks that read the
 *  same on every destination; the arrow joins a watch to what reaching it would mean. */
export const WATCH_MARK_GLYPHS = Object.freeze({
  met: '✓',
  unmet: '✗',
  unobserved: '…',
} as const satisfies Record<WatchMark, string>)

export const EFFECT_ARROW = '→'

/** Geometric, not emoji: these sit in columns of rows, where one cell per glyph is what keeps the
 *  labels aligned. Carried by anything whose value could have gone the other way. The neutral mark
 *  is filled like the arrows rather than a middle dot, which reads as a missing glyph beside them. */
export const DIRECTION_MARKS = Object.freeze({ up: '▲', down: '▼', flat: '◆' })

/** How urgent one row is, where a list mixes both. Keyed by the severity itself, so a row can never
 *  be marked by a branch that disagrees with what it was classified as. */
export const SEVERITY_MARKS = Object.freeze({
  info: 'ℹ️',
  warn: '⚠️',
} satisfies Record<CaveatSeverity, string>)

/** Which way a trade goes, on a row that proposes one. A section header names a block; these name
 *  one row inside it, which is why they are not `SECTION_ICONS`. */
export const SIDE_MARKS = Object.freeze({
  buy: '🟢',
  sell: '🔴',
} satisfies Record<OrderSide, string>)

const PERCENT_PER_UNIT = 100
/** Where a value stops being quoted in decimal places and starts being quoted in significant ones. */
const SUB_UNIT_FLOOR = 1
/** Half of the last digit `formatFraction` displays. Below it a change prints as 0%, and a verb
 *  read off the raw sign would tell the operator to trade nothing. */
const FRACTION_DISPLAY_EPSILON = FRACTION_QUANTUM / 2
/** A headline renders unlabelled on its own line, so one that wraps breaks the block it sits in. */
const HEADLINE_MAXIMUM_CHARACTERS = 90
const HEADLINE_TRUNCATION = '...'

/** Read through `RenderContext` by every renderer that pads, so one surface's tables cannot drift
 *  from another's. */
type ColumnLayout = 'table' | 'lines'

/** What a phone and a terminal each fit on one line. A channel line longer than this wraps, and a
 *  wrapped line loses the indent that says which row it belongs to. */
const RENDER_WIDTHS = Object.freeze({ repl: 90, channel: 45 })

/** What a renderer needs from where its text is going: the operator's clock, how wide a line may
 *  run, and whether it may rely on column alignment. Threaded together because a surface that
 *  needs one needs the others, and all three are properties of the destination. */
export interface RenderContext {
  readonly timezone: string
  readonly layout: ColumnLayout
  readonly width: number
  /** Off where a model relays the text word for word: a chart is glyphs it would have to copy, and
   *  the numbers beside it already carry the reading. */
  readonly charts: boolean
}

/** What a pushed message is written for. A notice has no invoking surface - nobody ran a command -
 *  and it is read in a chat client, so it takes the narrow shape. */
export const NOTICE_SURFACE = 'notice'

/** What a tool result is written for: it is relayed into a chat message, never a repl table. */
export const TOOL_SURFACE = 'tool'

/** Only the REPL is monospace and wide; a chat client renders padded columns as ragged text and
 *  wraps anything past a phone's line. */
export function resolveRenderContext(timezone: string, surface: string): RenderContext {
  const repl = surface === 'repl'

  return {
    timezone,
    layout: repl ? 'table' : 'lines',
    width: repl ? RENDER_WIDTHS.repl : RENDER_WIDTHS.channel,
    charts: surface !== TOOL_SURFACE,
  }
}

export function formatHeadline(text: string): string {
  if (text.length <= HEADLINE_MAXIMUM_CHARACTERS) {
    return text
  }

  const cut = text.slice(0, HEADLINE_MAXIMUM_CHARACTERS)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trimEnd()}${HEADLINE_TRUNCATION}`
}

export function formatAmount(locale: Locale, value: number): string {
  return formatNumber(locale, isSubUnit(value) ? 'subUnit' : 'amount', value)
}

export function formatFixedAmount(locale: Locale, value: number): string {
  return formatNumber(locale, isSubUnit(value) ? 'subUnitFixed' : 'amountFixed', value)
}

/** Whether the value is small enough that decimal places stop carrying it and significant digits
 *  take over: `Intl` reports two decimals for `BTC` and `XAU`, which are not ISO currencies, and a
 *  coin trading at 0.00002 needs every digit after the point. */
export function isSubUnit(value: number): boolean {
  return value !== 0 && Math.abs(value) < SUB_UNIT_FLOOR
}

export function formatQuantity(locale: Locale, value: number): string {
  return formatNumber(locale, 'exact', value)
}

/** A number written into a slash command the reader can send back. Locale-free on purpose: the
 *  slash parser reads JS number syntax, so a grouped or comma-decimal rendering would be refused or
 *  misread. Rounded to the quantity precision so no binary artefact prints. */
export function formatCommandNumber(value: number): string {
  return String(Number(value.toFixed(CRYPTO_SUBUNIT_DIGITS)))
}

/** A figure the reader is checking against a broker slip, printed at the precision it was recorded
 *  at. `formatAmount` rounds to two decimals above one unit, which reads plausibly and hides what
 *  the row actually holds - on a ledger confirmation that is the one thing it must not do. */
export function formatExactAmount(locale: Locale, value: number): string {
  return formatNumber(locale, 'exact', value)
}

export function formatCount(locale: Locale, value: number): string {
  return formatNumber(locale, 'count', value)
}

export function formatSignedCount(locale: Locale, value: number): string {
  return withGlyph(value, (magnitude) => formatCount(locale, magnitude))
}

export function formatSignedFlow(locale: Locale, value: number): string {
  return withGlyph(value, (magnitude) => formatNumber(locale, 'compact', magnitude))
}

/** Unsigned compact money: market cap, open interest, ETF flows all read in the same billions scale. */
export function formatFlow(locale: Locale, value: number): string {
  return formatNumber(locale, 'compact', value)
}

/** A ratio with its multiplication sign, so OI-vs-20-session and turnover-vs-20-session read as
 *  multiples, not prices. */
export function formatMultiple(locale: Locale, value: number): string {
  return `${formatNumber(locale, 'ratio', value)}×`
}

/** The trading module carries both units under a `*Pct` name: valuation weights and returns are
 *  percents, while profile targets, caps, and the advice rows derived from them are fractions. */
export function formatFraction(locale: Locale, fraction: number): string {
  return formatNumber(locale, 'percent', fraction)
}

/** A fraction for a padded numeric column, where the decimal points must line up. */
export function formatFixedFraction(locale: Locale, fraction: number): string {
  return formatNumber(locale, 'percentFixed', fraction)
}

/** For a percent-valued field, where 12.5 means 12.5%. */
export function formatPercent(locale: Locale, percent: number): string {
  return formatFraction(locale, percent / PERCENT_PER_UNIT)
}

/** The column form of `formatPercent`, for a percent-valued field repeated down a list. */
export function formatFixedPercent(locale: Locale, percent: number): string {
  return formatFixedFraction(locale, percent / PERCENT_PER_UNIT)
}

/** A rank over a few dozen peers, where every decimal is quantization rather than precision:
 *  84.78th of 46 names is the 85th, and printing the remainder claims a resolution it lacks. The
 *  standing is worded rather than written `p78`, a notation no message ever defined - it is still
 *  not a share, and what it says is how many of its peers this reading is above. */
export function formatPercentRank(locale: Locale, percent: number): string {
  return t(locale, 'trading.render.layout.percentRank', {
    pct: formatCount(locale, Math.round(percent)),
  })
}

/** A 0-1 index as whole percent. Coverage and agreement are folds over weights, not measured
 *  quantities: a second decimal on them claims a resolution the fold never had. */
export function formatWholeFraction(locale: Locale, fraction: number): string {
  return formatNumber(locale, 'percentWhole', fraction)
}

/** A risk-reward ratio, where the third decimal is noise: 1.56 and 1.559 buy the same trade. */
export function formatRatio(locale: Locale, ratio: number): string {
  return formatNumber(locale, 'ratio', ratio)
}

export function formatSignedPercent(locale: Locale, percent: number): string {
  return withGlyph(percent, (magnitude) => formatPercent(locale, magnitude))
}

/** The column form: a price block pads its rows, and a change that prints two decimals on one row
 *  and none on the next puts the decimal point in a different place down the page. */
export function formatSignedFixedPercent(locale: Locale, percent: number): string {
  return withGlyph(percent, (magnitude) =>
    formatFixedFraction(locale, magnitude / PERCENT_PER_UNIT)
  )
}

export function formatSignedQuantity(locale: Locale, value: number): string {
  return withGlyph(value, (magnitude) => formatQuantity(locale, magnitude))
}

export function formatSignedFraction(locale: Locale, fraction: number): string {
  return withGlyph(fraction, (magnitude) => formatFraction(locale, magnitude))
}

export function formatSignedFixedFraction(locale: Locale, fraction: number): string {
  return withGlyph(fraction, (magnitude) => formatFixedFraction(locale, magnitude))
}

/** Arrow *and* sign. The arrow is a shape the eye catches while scanning a column; the minus is the
 *  datum, and it has to survive being read on its own — inside brackets, or beside a second number
 *  the arrow does not govern. A flat reading gets no arrow, since decorating zero would imply a
 *  move that did not happen. */
export function withGlyph(value: number, format: (value: number) => string): string {
  const text = format(value)

  // A non-finite value already rendered as the absent cell; zero would assert a reading.
  if (!Number.isFinite(value)) {
    return text
  }

  // Judged off the rendered text, not the raw value: a move too small to survive this quantity's
  // rounding prints as zero, and an arrow beside it would claim a direction the number no longer
  // shows.
  if (!hasMagnitude(text)) {
    return format(0)
  }

  return value > 0 ? `${DIRECTION_MARKS.up} ${text}` : `${DIRECTION_MARKS.down} ${text}`
}

/** Factor scores live in [-1, 1]; the forced sign is what tells a bullish read from a bearish one. */
export function formatScore(locale: Locale, score: number): string {
  return `${formatScoreValue(locale, score)} (${renderScoreBand(locale, score)})`
}

/** A score as a reader says it - "Bullish", never 0,43 - which is all a model is ever handed. */
export function renderScoreBand(locale: Locale, score: number): string {
  return t(locale, `trading.factor.band.${scoreBand(score)}`)
}

/** The score scale without the band. A factor's contribution to the composite lives on the same
 *  scale, but a verbal band describes how a factor read, not the share of the verdict it moved. */
export function formatScoreValue(locale: Locale, score: number): string {
  return formatNumber(locale, 'score', score)
}

/** A gauge showing *how far* into bullish/bearish territory, not just the sign. Quantized by band
 *  so the bar and the word beside it can never disagree, and so the smallest non-zero score still
 *  shows one block carrying its direction. */
const SCORE_BAR_WIDTH = 5
const BAND_BLOCKS: Readonly<Record<ScoreBand, number>> = Object.freeze({
  'very-bearish': 5,
  bearish: 3,
  neutral: 1,
  bullish: 3,
  'very-bullish': 5,
})

export function scoreBar(locale: Locale, score: number): string {
  const filled = BAND_BLOCKS[scoreBand(score)]

  return scoreBarGlyph(locale, score).repeat(filled) + '░'.repeat(SCORE_BAR_WIDTH - filled)
}

/** Judged off the rendered score, like every other direction mark: a factor that leans too little
 *  to survive two decimals prints `0,00`, and a bar pointing down beside it claimed a bearish read
 *  the number does not carry. */
function scoreBarGlyph(locale: Locale, score: number): string {
  if (!hasMagnitude(formatScoreValue(locale, score))) {
    return DIRECTION_MARKS.flat
  }

  return score > 0 ? DIRECTION_MARKS.up : DIRECTION_MARKS.down
}

const SENTIMENT_SCALE_MAX = 100
/** Alternative.me's published fear-and-greed bands. Derived from the score, never from the
 *  provider's English label, so the reader always gets a translated word. */
const SENTIMENT_BANDS = Object.freeze([
  { ceiling: 24, band: 'extreme-fear' },
  { ceiling: 44, band: 'fear' },
  { ceiling: 55, band: 'neutral' },
  { ceiling: 75, band: 'greed' },
  { ceiling: SENTIMENT_SCALE_MAX, band: 'extreme-greed' },
] as const)

type SentimentBand = (typeof SENTIMENT_BANDS)[number]['band']

function sentimentBand(score: number): SentimentBand {
  let last: SentimentBand = 'extreme-greed'
  for (const entry of SENTIMENT_BANDS) {
    last = entry.band
    if (score <= entry.ceiling) {
      return entry.band
    }
  }
  return last
}

export function bandedSentiment(locale: Locale, score: number): string {
  const word = t(locale, `trading.sentiment.${sentimentBand(score)}`)
  return `${word} ${formatCount(locale, score)}/${SENTIMENT_SCALE_MAX}`
}

/** A manifest-declared value — a quote unit, a segment — has no place in `MessageKey`, which is
 *  derived from the catalogs, because the registry is what declares it. `tradingLocaleKeys` derives
 *  the same key from the same registry and composition throws when it has no translation, so a key
 *  that reaches a renderer is present in both catalogs.
 *
 *  why-safe: the boot gate above is the check the type system cannot perform here. */
export function renderDeclaredValue(
  locale: Locale,
  key: `trading.${string}`,
  params?: Record<string, string | number>
): string {
  return t(locale, key as MessageKey, params)
}

/** A value a provider supplies rather than the registry, so no boot gate can promise a translation
 *  for it. Rendered when the catalog carries it, left as the provider wrote it when not: a taxonomy
 *  that outgrows the catalog must degrade to English words, never to a printed key. */
export function renderProvidedValue(locale: Locale, key: `trading.${string}`, raw: string): string {
  return hasMessage(locale, key) ? renderDeclaredValue(locale, key) : raw
}

/** A broker the operator declared has no catalog name, so its id prints in capitals, the way
 *  brokers write their own names (SSI, TCBS). */
function declaredVenueName(venue: string): string {
  return venue.toUpperCase()
}

/** The one name a venue prints under. Composition gates `trading.venue.<id>` in every catalog for
 *  the venues the build ships. */
export function renderVenueName(locale: Locale, venue: string): string {
  return renderProvidedValue(locale, `trading.venue.${venue}`, declaredVenueName(venue))
}

/** The same name for a message rendered later, in whichever language reads it. */
export function venueParam(venue: string): { readonly key: string; readonly fallback: string } {
  return { key: `trading.venue.${venue}`, fallback: declaredVenueName(venue) }
}

/** Joins the subjects of one caveat sentence, and splits them back apart in `renderSubject`. */
export const CAVEAT_SUBJECT_SEPARATOR = ', '

/** The direction a rendered percentage will actually show. `flat` covers everything that rounds
 *  away, so a caller never labels an invisible change as an action. */
export function fractionDirection(fraction: number): 'up' | 'down' | 'flat' {
  if (fraction >= FRACTION_DISPLAY_EPSILON) {
    return 'up'
  }

  return fraction <= -FRACTION_DISPLAY_EPSILON ? 'down' : 'flat'
}

const TOP_FACTOR_COUNT = 3

/** The leading evidence the caller ranked, which is where "which factors explain this" is decided
 *  - choosing on score alone would promote whichever factor merely holds the largest number. Once
 *  chosen, they read strongest support first and strongest objection last, as every other factor
 *  list does. Abstained factors score exactly zero and are skipped: an abstention is not weak
 *  evidence. One line each: a label runs from eleven to twenty-eight characters, so inline the
 *  bars land somewhere different on every row and cannot be read down the page. The bar already
 *  quantizes the band, so a word beside it would say the same thing a third time. */
export function renderTopFactorLines(
  locale: Locale,
  entries: readonly { readonly id: string; readonly score: number }[]
): readonly string[] {
  return entries
    .filter((entry) => entry.score !== 0)
    .slice(0, TOP_FACTOR_COUNT)
    .toSorted((left, right) => right.score - left.score)
    .map(
      (entry) =>
        `${scoreBar(locale, entry.score)} ${renderDeclaredValue(locale, `trading.factor.${entry.id}`)} ${formatScoreValue(locale, entry.score)}`
    )
}
