import type { Locale } from '@/core/types/locale'
import type { PriceDisplay, Ticker } from '@/trading/kernel/instrument'
import type { AnalystRecommendation, NewsItem } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { isSourceFailed } from '@/trading/kernel/source/source-result'
import { normalizeTitle, rankHeadlines } from '@/trading/markets/news'
import { formatPrice } from '@/trading/render/money'
import { utcDayOf } from '@/trading/sources/rows/normalization'

export const MAXIMUM_EVIDENCE_NEWS_ITEMS = 8
const MAXIMUM_HEADLINE_CHARS = 200
export const MAXIMUM_SUMMARY_CHARS = 320

const HEADLINES_UNAVAILABLE =
  'HEADLINES: unavailable - the news feed failed this run, so this is not a quiet tape; never argue from the absence of news.'
const MARKET_HEADLINES_UNAVAILABLE =
  'MARKET HEADLINES: unavailable - the market news feed failed this run.'
const COVERAGE_UNAVAILABLE =
  'ANALYST COVERAGE: unavailable - the coverage feed failed this run; never read it as no coverage.'

export function newsSection(
  items: readonly NewsItem[],
  read: SourceResult<unknown> | undefined
): string {
  if (items.length === 0) {
    return isSourceFailed(read) ? HEADLINES_UNAVAILABLE : ''
  }

  return [
    'HEADLINES (cite by url; do not assert anything they do not say):',
    ...items.map(evidenceRow),
  ].join('\n')
}

interface MarketNewsSectionInput {
  readonly items: readonly NewsItem[]
  readonly subject: Ticker
  readonly read: SourceResult<unknown> | undefined
}

/** Held apart from the instrument's own headlines. Most names have no coverage on a given day, so
 *  the market's is what a persona would otherwise reason without — but it names other companies,
 *  and folding it into the section above is how it gets attributed to this one. */
export function marketNewsSection(input: MarketNewsSectionInput): string {
  const { items, subject } = input

  if (items.length === 0) {
    return isSourceFailed(input.read) ? MARKET_HEADLINES_UNAVAILABLE : ''
  }

  return [
    'MARKET HEADLINES (background only; never attribute these to this instrument):',
    ...items.map((item) => `- (background, not ${subject}) ${headlineText(item)}`),
  ].join('\n')
}

interface ConsensusSectionInput {
  readonly rows: readonly AnalystRecommendation[]
  readonly locale: Locale
  readonly display: PriceDisplay | undefined
  readonly read: SourceResult<unknown> | undefined
}

/** Analyst coverage is evidence to weigh, exactly like a headline — never a factor or a conviction
 *  input. The positivity-bias note travels with it because sell-side coverage skews bullish. */
export function consensusSection(input: ConsensusSectionInput): string {
  const { rows, locale, display } = input

  if (rows.length === 0) {
    return isSourceFailed(input.read) ? COVERAGE_UNAVAILABLE : ''
  }

  const totals = rows.reduce(
    (sum, row) => ({
      buy: sum.buy + row.buyCount,
      hold: sum.hold + row.holdCount,
      sell: sum.sell + row.sellCount,
    }),
    { buy: 0, hold: 0, sell: 0 }
  )

  const target = meanTargetPrice(rows)

  return [
    'ANALYST COVERAGE (sell-side coverage skews bullish; weigh accordingly):',
    `- buy ${totals.buy}, hold ${totals.hold}, sell ${totals.sell}`,
    ...(target === undefined
      ? []
      : [`- mean target price ${formatPrice(locale, target, display)}`]),
  ].join('\n')
}

/** The reports that named a target, averaged. A report without one is coverage, not a price view,
 *  so it counts toward the ratings above and not toward this. */
function meanTargetPrice(rows: readonly AnalystRecommendation[]): number | undefined {
  const targets = rows.flatMap((row) => (row.targetPrice === undefined ? [] : [row.targetPrice]))

  if (targets.length === 0) {
    return undefined
  }

  return Math.round(targets.reduce((sum, price) => sum + price, 0) / targets.length)
}

/** A story the instrument's own read already carried is not background: printed in both sections it
 *  would arrive once inviting citation and once forbidding it. Keyed by title, because an
 *  aggregator and the publisher it carries give one story two urls. */
export function withoutStories(
  items: readonly NewsItem[],
  carried: readonly NewsItem[]
): readonly NewsItem[] {
  const titles = new Set(carried.map((item) => normalizeTitle(item.title)))

  return items.filter((item) => !titles.has(normalizeTitle(item.title)))
}

/** Ranked rather than sliced: a scope reads several feeds, merged in feed order, so taking the
 *  first rows hands every slot to whichever publisher files most often. */
export function headlines(
  result: SourceResult<readonly NewsItem[]> | undefined,
  now: number
): readonly NewsItem[] {
  return result?.kind === 'available'
    ? rankHeadlines(result.value, { now, limit: MAXIMUM_EVIDENCE_NEWS_ITEMS })
    : []
}

function headlineRow(item: NewsItem): string {
  return `- ${headlineText(item)}`
}

function headlineText(item: NewsItem): string {
  const day = utcDayOf(item.publishedAt)

  return `${item.title.slice(0, MAXIMUM_HEADLINE_CHARS)} (${day}) ${item.url}`
}

/** The instrument's own coverage carries its abstract, because this is the text a claim is verified
 *  against and a headline often cannot settle one. Market background stays headline-only: the
 *  personas are told not to reason from it about this name, so paying tokens to expand it buys
 *  nothing. */
function evidenceRow(item: NewsItem): string {
  const head = headlineRow(item)
  const summary = item.summary?.trim() ?? ''

  return summary === '' ? head : `${head}\n    ${summary.slice(0, MAXIMUM_SUMMARY_CHARS)}`
}
