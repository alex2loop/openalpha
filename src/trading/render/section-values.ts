import type { Locale } from '@/core/types/locale'
import type { ConvictionBand, OutcomeStatus, SuggestionAction } from '@/trading/kernel/conviction'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type {
  IndexReviewKind,
  MarketEventKind,
  MarketRegime,
} from '@/trading/kernel/market/market-data'
import type { AlertCondition } from '@/trading/kernel/operator/alert'
import type { CashPosture } from '@/trading/kernel/operator/book'
import type {
  BriefActionCode,
  BriefAggressorSide,
  BriefDirection,
  BriefField,
  BriefNumericField,
  BriefReading,
  BriefSectionValue,
  BriefStopBasis,
} from '@/trading/kernel/operator/brief-section'
import type { DisclosureKind } from '@/trading/markets/disclosure-calendar'
import { formatSpendUsd } from '@/core/utils/cost'
import { formatDay, type MessageKey, t } from '@/i18n'
import { BRIEF_NUMERIC_FIELDS } from '@/trading/kernel/operator/brief-section'
import { isTradingDayText } from '@/trading/render/datetime'
import {
  bandedSentiment,
  formatAmount,
  formatCount,
  formatFixedAmount,
  formatFixedFraction,
  formatFixedPercent,
  formatFlow,
  formatFraction,
  formatHeadline,
  formatMultiple,
  formatPercent,
  formatPercentRank,
  formatRatio,
  formatScore,
  formatScoreValue,
  formatSignedCount,
  formatSignedFixedFraction,
  formatSignedFixedPercent,
  formatSignedFlow,
  formatSignedFraction,
  formatWholeFraction,
  renderProvidedValue,
  scoreBar,
} from '@/trading/render/format'
import { formatFixedPrice } from '@/trading/render/money'

const NOTE_SEPARATOR = ', '

const VIETNAMESE_LETTER_RE =
  /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/iu

const NUMERIC_FIELDS: ReadonlySet<string> = new Set(BRIEF_NUMERIC_FIELDS)

// Every map below is exhaustive by `satisfies`: a value with no entry renders as its raw slug, and
// no locale gate catches that, because the key it would have looked for does not exist yet.
const REGIME_KEYS = Object.freeze({
  neutral: 'trading.regime.neutral',
  'risk-off': 'trading.regime.risk-off',
  'risk-on': 'trading.regime.risk-on',
} as const satisfies Record<MarketRegime, MessageKey>)

const DIRECTION_KEYS = Object.freeze({
  buy: 'trading.brief.direction.buy',
  over: 'trading.brief.direction.over',
  sell: 'trading.brief.direction.sell',
  under: 'trading.brief.direction.under',
  entered: 'trading.brief.direction.entered',
  left: 'trading.brief.direction.left',
} as const satisfies Record<BriefDirection, MessageKey>)

const AGGRESSOR_SIDE_KEYS = Object.freeze({
  balanced: 'trading.brief.aggressor.balanced',
  buy: 'trading.brief.aggressor.buy',
  sell: 'trading.brief.aggressor.sell',
} as const satisfies Record<BriefAggressorSide, MessageKey>)

const ACTION_CODE_KEYS = Object.freeze({
  'add-watchlist': 'trading.brief.action.add-watchlist',
  'avoid-chasing': 'trading.brief.action.avoid-chasing',
  rebalance: 'trading.brief.action.rebalance',
  'record-book': 'trading.brief.action.record-book',
  'review-alerts': 'trading.brief.action.review-alerts',
  'review-portfolio': 'trading.brief.action.review-portfolio',
  'review-suggestions': 'trading.brief.action.review-suggestions',
} as const satisfies Record<BriefActionCode, string>)

const EVENT_KEYS = Object.freeze({
  'additional-listing': 'trading.event.additional-listing',
  agm: 'trading.event.agm',
  delisting: 'trading.event.delisting',
  'dividend-ex-date': 'trading.event.dividend-ex-date',
  'last-trading-day': 'trading.event.last-trading-day',
  listing: 'trading.event.listing',
  'margin-eligible': 'trading.event.margin-eligible',
  'margin-ineligible': 'trading.event.margin-ineligible',
  'meeting-ex-date': 'trading.event.meeting-ex-date',
  'rights-issue': 'trading.event.rights-issue',
  split: 'trading.event.split',
} as const satisfies Record<MarketEventKind, MessageKey>)

/** Fields whose value is an enumeration, mapped value by value so every value that reaches a reader
 *  is a checked key. A field absent here holds a proper noun or a number; neither is translated. */
const DISCLOSURE_KEYS = Object.freeze({
  'quarterly-report': 'trading.disclosure.quarterly-report',
  'semi-annual-report': 'trading.disclosure.semi-annual-report',
  'annual-report': 'trading.disclosure.annual-report',
} as const satisfies Record<DisclosureKind, MessageKey>)

const INDEX_REVIEW_KEYS = Object.freeze({
  'ftse-geis': 'trading.index-review.ftse-geis',
  hose: 'trading.index-review.hose',
} as const satisfies Record<IndexReviewKind, MessageKey>)

const VALUE_KEYS: Partial<Record<BriefField, Readonly<Partial<Record<string, MessageKey>>>>> =
  Object.freeze({
    action: {
      buy: 'trading.brief.call.buy',
      hold: 'trading.brief.call.hold',
      reduce: 'trading.brief.call.reduce',
    } satisfies Record<SuggestionAction, MessageKey>,
    aggressorSide: AGGRESSOR_SIDE_KEYS,
    code: ACTION_CODE_KEYS,
    condition: {
      above: 'trading.alert.condition.above',
      below: 'trading.alert.condition.below',
    } satisfies Record<AlertCondition, MessageKey>,
    conviction: {
      high: 'trading.conviction.high',
      low: 'trading.conviction.low',
      medium: 'trading.conviction.medium',
    } satisfies Record<ConvictionBand, MessageKey>,
    currentRegime: REGIME_KEYS,
    direction: DIRECTION_KEYS,
    eventKind: { ...EVENT_KEYS, ...DISCLOSURE_KEYS, ...INDEX_REVIEW_KEYS },
    posture: {
      'fully-liquid': 'trading.posture.fully-liquid',
      'term-deposit-eligible': 'trading.posture.term-deposit-eligible',
    } satisfies Record<CashPosture, MessageKey>,
    previousRegime: REGIME_KEYS,
    reading: {
      'narrow-decline': 'trading.brief.reading.narrow-decline',
      'broad-decline': 'trading.brief.reading.broad-decline',
      'rise-unconfirmed': 'trading.brief.reading.rise-unconfirmed',
      'rise-confirmed': 'trading.brief.reading.rise-confirmed',
    } satisfies Record<BriefReading, MessageKey>,
    regime: REGIME_KEYS,
    status: {
      expired: 'trading.outcome.expired',
      stop: 'trading.outcome.stop',
      target: 'trading.outcome.target',
    } satisfies Record<OutcomeStatus, MessageKey>,
    stopBasis: {
      'volatility-resting': 'trading.brief.stop-basis.volatility-resting',
    } satisfies Record<BriefStopBasis, MessageKey>,
  })

/** Fields whose value is a code only the market registry can enumerate, so no closed map can list
 *  it. Composition already refuses to boot without these keys in both catalogs. */
const DECLARED_PREFIXES: Partial<Record<BriefField, `trading.${string}`>> = Object.freeze({
  market: 'trading.market',
  segment: 'trading.segment',
  driver: 'trading.macro.series',
  driverMissing: 'trading.macro.series',
  // The dropped-watchlist gate code, plus the two the brief adds when the screen has no verdict to
  // report; the raw-value fallback keeps a future gate readable until its sentence lands.
  reason: 'trading.screen.gate',
  // The one entry a provider supplies rather than the registry, which is why the render below
  // falls back to the raw value instead of trusting the boot gate.
  sector: 'trading.sector',
})

/** Every numeric field declares its unit. Exhaustive by `satisfies`, because the fallback for a
 *  missing entry is `String(value)` — a raw float in front of a reader. */
const VALUE_FORMATTERS = Object.freeze({
  aboveMa50Ratio: formatFraction,
  ma50Measured: formatCount,
  advanceRatio: formatFraction,
  advancers: formatCount,
  aggressorSharePct: formatFixedPercent,
  basisPct: formatFraction,
  buyPrice: formatFixedAmount,
  cashAfterPlanPctNav: formatFraction,
  ceilings: formatCount,
  changePct: formatSignedFixedPercent,
  compositeScore: formatScoreValue,
  contribution: formatScoreValue,
  coverage: formatWholeFraction,
  currentPctNav: formatFixedFraction,
  decliners: formatCount,
  deploymentScale: formatFraction,
  depositRate12m: formatFraction,
  entryTranchePct: formatFixedFraction,
  floors: formatCount,
  flowWindowUsd: formatSignedFlow,
  foreignNetBase: formatSignedFlow,
  foreignNetWindow: formatSignedFlow,
  funding: formatSignedFraction,
  index: formatFixedAmount,
  indexToMa50Pct: formatSignedFraction,
  largestSharePct: formatPercent,
  last: formatFixedAmount,
  previousClose: formatFixedAmount,
  level: formatFixedAmount,
  limitUsd: formatSpendUsd,
  liquidReservePctNav: formatFraction,
  losingCount: formatCount,
  losingReturnPct: formatSignedFixedFraction,
  longShortRatio: formatRatio,
  ma50SlopePct: formatSignedFraction,
  marketCap: formatFlow,
  maximumOpenRiskPctNav: formatFixedFraction,
  maximumSectorPctNav: formatFixedFraction,
  measured: formatCount,
  nav: formatFlow,
  net: formatSignedFlow,
  netAdvancers: formatSignedCount,
  netFlowUsd: formatSignedFlow,
  netLong: formatFlow,
  newHighs: formatCount,
  newLows: formatCount,
  observedPrice: formatFixedAmount,
  oiRatio: formatMultiple,
  openInterest: formatFlow,
  pendingCount: formatCount,
  premium: formatFraction,
  premiumPercentile: formatPercentRank,
  previousFlow: formatFlow,
  previousFraction: formatFixedFraction,
  previousMultiple: formatMultiple,
  previousSignedFlow: formatSignedFlow,
  previousSignedFraction: formatSignedFixedFraction,
  proprietaryNetWindow: formatSignedFlow,
  rate: formatAmount,
  relativeVolume: formatMultiple,
  reservePctNav: formatFixedFraction,
  resistance: formatFixedAmount,
  resistancePct: formatFixedFraction,
  resolvedCount: formatCount,
  returnPct: formatSignedFixedFraction,
  riskPerTradePctNav: formatFixedFraction,
  score: bandedScore,
  sellPrice: formatFixedAmount,
  sentimentScore: bandedSentiment,
  sharePct: formatFraction,
  spentUsd: formatSpendUsd,
  spreadPct: formatFraction,
  stopBreachedCount: formatCount,
  stopClearCount: formatCount,
  stopUnmeasuredCount: formatCount,
  strength: formatSignedFraction,
  support: formatFixedAmount,
  supportPct: formatFixedFraction,
  takeProfitTranchePct: formatFixedFraction,
  takerBuyPct: formatPercent,
  targetPctNav: formatFixedFraction,
  termDepositEligiblePctNav: formatFraction,
  threshold: formatFixedAmount,
  turnover: formatFlow,
  turnoverRatio: formatMultiple,
  value: formatRatio,
  valuePct: formatFixedFraction,
  volatilityDaily: formatFraction,
  weekChange: formatSignedFlow,
  winRate: formatFraction,
  yearPercentile: formatPercentRank,
} satisfies Record<BriefNumericField, (locale: Locale, value: number) => string>)

/** The same bar and band `/suggest` prints, so one score reads identically on both surfaces. */
function bandedScore(locale: Locale, score: number): string {
  return `${scoreBar(locale, score)} ${formatScore(locale, score)}`
}

/** Aggregate money, where the magnitude is compacted and nothing else on the row states the unit.
 *  Prices are excluded: a board-scaled quote is not in currency units, and `renderPricePair` already
 *  owns saying so. `netFlowUsd` and `flowWindowUsd` name their unit in the field, and `netLong` and
 *  `weekChange` count contracts rather than money. */
const MONEY_FIELDS: ReadonlySet<BriefField> = new Set([
  'foreignNetBase',
  'foreignNetWindow',
  'marketCap',
  'nav',
  'net',
  'openInterest',
  'proprietaryNetWindow',
  'turnover',
])

/** Prices that take the currency the surface resolved for their row - the section's own where it
 *  quotes one currency throughout, the row's where the rows come from different markets. A level
 *  the operator is watching is a price like the rest. A section publishing levels rather than
 *  prices declares no currency and these stay bare, which is what keeps an index from being
 *  stamped with a denomination it does not have. */
const PRICE_FIELDS: ReadonlySet<BriefField> = new Set([
  'buyPrice',
  'last',
  'observedPrice',
  'previousClose',
  'sellPrice',
  'threshold',
])

const TEXT_FORMATTERS: Partial<Record<BriefField, (value: string) => string>> = Object.freeze({
  title: formatHeadline,
})

/** Money carries the unit its row is denominated in; every other field either states its own or is
 *  not money at all — and a row whose header already named the currency says it once. */
function unitFor(field: BriefField, unit: RowUnit): string {
  const { currency } = unit

  if (currency === undefined || unit.stated === true) {
    return ''
  }

  return MONEY_FIELDS.has(field) || PRICE_FIELDS.has(field) ? ` ${currency}` : ''
}

function isNumericField(field: BriefField): field is BriefNumericField {
  return NUMERIC_FIELDS.has(field)
}

/** What a row's cells are denominated in. `currency` sets the precision they print at, which is a
 *  different question from whether they name it: a board under a header reading `VND/lượng` still
 *  needs đồng's own precision, and would restate the code on every cell to get it. */
export interface RowUnit {
  readonly currency?: CurrencyCode
  /** Set where something above the row already names the currency, so the message says it once. */
  readonly stated?: true
}

const URL_PARENTHESIS_RE = /[()]/g
const URL_PARENTHESIS = Object.freeze({ '(': '%28', ')': '%29' })
const LABEL_BRACKET_RE = /[[\]]/g
const LABEL_BRACKET = Object.freeze({ '[': '(', ']': ')' })
const LABEL_BREAK_RE = /\s*[\r\n]+\s*/g

interface LinkNotes {
  readonly reader: Locale
  readonly dated?: string
}

/** A headline that carries its source: the label is what prints, and the target travels behind it.
 *  Telegram reads a bare `)` as the end of a link, so the parentheses are encoded here - where the
 *  link is built is the only place that knows where the URL really ends. Notes follow in one
 *  parenthetical: the caller's own, then the headline's language where it is not the reader's,
 *  since sources publish verbatim. */
export function toLink(label: string, url: string, notes?: LinkNotes): string {
  const target = url.replace(
    URL_PARENTHESIS_RE,
    (char) => URL_PARENTHESIS[char as keyof typeof URL_PARENTHESIS]
  )
  const link = `[${linkLabel(label)}](${target})`

  if (notes === undefined) {
    return link
  }

  const written = writtenIn(label)
  const all = [
    ...(notes.dated === undefined ? [] : [notes.dated]),
    ...(written === notes.reader ? [] : [t(notes.reader, `trading.render.language.${written}`)]),
  ]

  return all.length === 0 ? link : `${link} (${all.join(NOTE_SEPARATOR)})`
}

/** The two catalog languages part on script: Vietnamese spells with letters English never uses. */
function writtenIn(text: string): Locale {
  return VIETNAMESE_LETTER_RE.test(text) ? 'vi' : 'en'
}

/** A headline is a third party's text: an unbalanced bracket would end the label early, and
 *  `Foo](https://other)` would turn it into a link of the headline's own choosing. */
function linkLabel(label: string): string {
  return label
    .replace(LABEL_BREAK_RE, ' ')
    .replace(LABEL_BRACKET_RE, (char) => LABEL_BRACKET[char as keyof typeof LABEL_BRACKET])
}

/** A field's text and the unit it is denominated in, under one owner: a price formatted at one
 *  currency's precision and labelled with another is the same defect printed twice. A row that
 *  declares no currency is publishing levels or board points, and both stay bare and unrounded —
 *  which is what keeps a board price of 22,60 from being read as đồng and rounded to a whole one. */
export function renderValue(
  locale: Locale,
  entry: readonly [BriefField, BriefSectionValue],
  unit: RowUnit = {}
): string {
  const [field] = entry

  return `${valueText(locale, entry, unit.currency)}${unitFor(field, unit)}`
}

function valueText(
  locale: Locale,
  entry: readonly [BriefField, BriefSectionValue],
  currency?: CurrencyCode
): string {
  const [field, value] = entry
  const key = VALUE_KEYS[field]?.[String(value)]

  if (key !== undefined) {
    return t(locale, key)
  }

  const prefix = DECLARED_PREFIXES[field]

  if (prefix !== undefined) {
    return renderProvidedValue(locale, `${prefix}.${value}`, String(value))
  }

  if (typeof value === 'string') {
    const text = TEXT_FORMATTERS[field]

    if (text !== undefined) {
      return text(value)
    }

    if (isTradingDayText(value)) {
      return formatDay(locale, value)
    }
  }

  if (typeof value !== 'number') {
    return String(value)
  }

  if (currency !== undefined && PRICE_FIELDS.has(field)) {
    return formatFixedPrice(locale, value, currency)
  }

  const format = isNumericField(field) ? VALUE_FORMATTERS[field] : undefined

  return format === undefined ? String(value) : format(locale, value)
}
