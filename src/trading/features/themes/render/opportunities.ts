import type { Locale } from '@/core/types/locale'
import type { ReportContext, ScoreGroup } from '@/trading/features/themes/render/shared'
import type { SectorRead, StockRead } from '@/trading/features/themes/types'
import { t } from '@/i18n'
import {
  groupByScore,
  notesOf,
  renderClaims,
  renderScoreFacts,
  renderSectorName,
  titleOf,
} from '@/trading/features/themes/render/shared'
import { toExpectedReturn } from '@/trading/features/themes/score/reads'
import {
  formatPercent,
  formatRatio,
  formatSignedFraction,
  formatSignedPercent,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, joinEntries } from '@/trading/render/layout'

/** The rest stay in the read-only tool; the report is the shortlist of the shortlist. */
const SHOWN_SECTORS = 5
const SHOWN_STOCKS = 5
const LIST_SEPARATOR = ', '

interface Ranked {
  readonly context: ReportContext
  readonly rank: number
}

/** Across every theme, so the strongest sector leads whichever theme it came from. A sector the
 *  theme hurts is named under its theme instead. */
export function renderTopSectors(context: ReportContext): readonly string[] {
  const sectors = groupByScore(
    context.report.reads.sectors.filter((read) => read.effect === 'benefits'),
    (read) => read.sector
  ).slice(0, SHOWN_SECTORS)

  return sectors.length === 0
    ? []
    : [
        t(context.locale, 'trading.render.themes.topSectors'),
        ...joinEntries(
          sectors.map((group, index) => renderSector(group, { context, rank: index + 1 }))
        ),
      ]
}

function renderSector(group: ScoreGroup<SectorRead>, input: Ranked): readonly string[] {
  const { context } = input
  const { locale } = context
  const read = group.best
  const head = [
    t(locale, 'trading.render.themes.sectorHead', {
      sector: renderSectorName(locale, read.sector),
      linkage: t(locale, `trading.themes.linkage.${read.linkage}`),
      theme: titleOf(context, read.themeId),
    }),
    ...renderScoreFacts(context, { ...read, level: 'sector', subject: read.sector }),
  ]
  const named = context.report.reads.stocks.some(
    (stock) => stock.themeId === read.themeId && stock.sector === read.sector
  )
  const failed = notesOf(context, read.themeId).some(
    (note) => note.level === 'stock' && note.sector === read.sector
  )

  return [
    `${input.rank}. ${head.join(INLINE_SEPARATOR)}`,
    `${INDENT[1]}${read.chain}`,
    ...renderAlsoUnder(group, context),
    ...(named || failed ? [] : [`${INDENT[1]}${t(locale, 'trading.render.themes.noShortlist')}`]),
  ]
}

export function renderTopStocks(context: ReportContext): readonly string[] {
  const stocks = groupByScore(context.report.reads.stocks, (read) => read.ticker).slice(
    0,
    SHOWN_STOCKS
  )

  return stocks.length === 0
    ? []
    : [
        t(context.locale, 'trading.render.themes.topStocks'),
        ...joinEntries(
          stocks.map((group, index) => renderStock(group, { context, rank: index + 1 }))
        ),
      ]
}

function renderStock(group: ScoreGroup<StockRead>, input: Ranked): readonly string[] {
  const { context } = input
  const { locale } = context
  const read = group.best

  return [
    `${input.rank}. ${renderStockHead(read, context)}`,
    `${INDENT[1]}${t(locale, 'trading.render.themes.place', {
      theme: titleOf(context, read.themeId),
      sector: renderSectorName(locale, read.sector),
    })}`,
    ...renderAlsoUnder(group, context),
    ...renderClaims(t(locale, 'trading.render.themes.why'), read.chain),
    `${INDENT[1]}${renderEarnings(read, locale)}`,
    `${INDENT[1]}${renderValuation(read, locale)}`,
    ...renderClaims(t(locale, 'trading.render.themes.catalysts'), read.catalysts),
    ...renderClaims(t(locale, 'trading.render.themes.stockRisks'), read.risks),
    `${INDENT[1]}${t(locale, 'trading.render.themes.horizon', { months: read.horizonMonths })}`,
    ...renderClaims(t(locale, 'trading.render.themes.endsIf'), read.invalidation),
  ]
}

/** The other themes that reach the same name or sector, so the one entry still says all of them. */
function renderAlsoUnder(
  group: ScoreGroup<SectorRead | StockRead>,
  context: ReportContext
): readonly string[] {
  return group.others.length === 0
    ? []
    : [
        `${INDENT[1]}${t(context.locale, 'trading.render.themes.alsoUnder', {
          themes: group.others.map((read) => titleOf(context, read.themeId)).join(LIST_SEPARATOR),
        })}`,
      ]
}

function renderStockHead(read: StockRead, context: ReportContext): string {
  const { locale } = context

  return [
    `**${read.ticker}**`,
    ...renderScoreFacts(context, { ...read, level: 'stock', subject: read.ticker }),
    t(locale, `trading.themes.exposure.${read.exposure.label}`),
    ...(read.crowding.crowded ? [t(locale, 'trading.render.themes.crowded')] : []),
  ].join(INLINE_SEPARATOR)
}

function renderEarnings(read: StockRead, locale: Locale): string {
  const { base } = read.scenarios
  const growth = read.surprise?.growth
  const facts = [
    t(locale, 'trading.render.themes.baseEps', {
      growth: formatSignedPercent(locale, base.epsGrowthPct),
      months: read.horizonMonths,
    }),
    t(locale, `trading.themes.verdict.${read.verdict}`),
    ...(growth === undefined
      ? []
      : [
          t(locale, 'trading.render.themes.surprise', {
            growth: formatSignedFraction(locale, growth),
          }),
        ]),
  ]

  return t(locale, 'trading.render.themes.earnings', { facts: facts.join(INLINE_SEPARATOR) })
}

function renderValuation(read: StockRead, locale: Locale): string {
  const expected = toExpectedReturn(read)
  const facts = [
    renderPe(read, locale),
    ...(expected === undefined
      ? []
      : [
          t(locale, 'trading.render.themes.expected', {
            expected: formatSignedFraction(locale, expected),
            months: read.horizonMonths,
          }),
        ]),
  ]

  return t(locale, 'trading.render.themes.valuation', { facts: facts.join(INLINE_SEPARATOR) })
}

function renderPe(read: StockRead, locale: Locale): string {
  const { pe } = read
  const percentile = read.crowding.pePercentile

  if (pe === undefined) {
    return t(locale, 'trading.render.themes.noPe')
  }

  return percentile === undefined
    ? t(locale, 'trading.render.themes.pe', { pe: formatRatio(locale, pe) })
    : t(locale, 'trading.render.themes.peRanked', {
        pe: formatRatio(locale, pe),
        percentile: formatPercent(locale, percentile),
      })
}
