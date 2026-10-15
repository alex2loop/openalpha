import type { ChainContext } from '@/trading/features/themes/chain/context'
import type { ChainDeps, ChainRequest } from '@/trading/features/themes/chain/deps'
import type { EvidencePart } from '@/trading/features/themes/evidence/deps'
import type { EarningsSurprise, EvidenceDraft } from '@/trading/features/themes/types'
import type { Ticker } from '@/trading/kernel/instrument'
import type { AccountsYearField, TrailingAccounts } from '@/trading/kernel/market/annual-accounts'
import type { Candle, NewsItem } from '@/trading/kernel/market/market-data'
import { toEarningsSurprise } from '@/trading/features/themes/chain/quarters'
import { toStoryKey } from '@/trading/features/themes/evidence/news'
import {
  formatBillions,
  formatFigure,
  formatLevel,
  formatShare,
} from '@/trading/features/themes/evidence/series'
import { THEME_MARKET } from '@/trading/features/themes/types'
import { utcDayOf } from '@/trading/sources/rows/normalization'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const SHOWN_YEARS = 3
const SHOWN_HEADLINES = 6
/** The lines a year prints. A bank files no revenue, margin or cash flow; the last three are its own. */
const YEAR_FIGURES: readonly YearFigure[] = Object.freeze([
  { field: 'netRevenue', label: 'revenue', unit: 'billions' },
  { field: 'grossMargin', label: 'gross margin', unit: 'level' },
  { field: 'netProfitToParent', label: 'net profit', unit: 'billions' },
  { field: 'freeCashFlow', label: 'free cash flow', unit: 'billions' },
  { field: 'returnOnInvestedCapital', label: 'ROIC', unit: 'level' },
  { field: 'netDebtToEbitda', label: 'net debt to EBITDA', unit: 'figure' },
  { field: 'netInterestToAssets', label: 'net interest to assets', unit: 'level' },
  { field: 'costToIncome', label: 'cost to income', unit: 'level' },
  { field: 'capitalAdequacy', label: 'capital adequacy', unit: 'level' },
])

interface YearFigure {
  readonly field: AccountsYearField
  readonly label: string
  readonly unit: 'billions' | 'level' | 'figure'
}

export interface CompanyInput {
  readonly ticker: Ticker
  readonly context: ChainContext
  readonly request: ChainRequest
  readonly benchmark?: readonly Candle[]
}

interface AccountsPart extends EvidencePart {
  readonly surprise?: EarningsSurprise
}

export interface HeadlinesPart extends EvidencePart {
  /** Absent when the news read failed: no headlines read is not zero headlines. */
  readonly recent?: number
}

type Figures = Readonly<Partial<Record<AccountsYearField, number>>>

/** Missing when no filed year could be read; a quarter's surprise alone is not the accounts. */
export async function readAccountsPart(
  deps: ChainDeps,
  input: CompanyInput
): Promise<AccountsPart> {
  const result = await deps.marketData.accounts({
    ticker: input.ticker,
    market: THEME_MARKET,
    now: input.request.now,
    signal: input.request.signal,
  })
  const history = result.kind === 'available' ? result.value : undefined
  const surprise = toEarningsSurprise(input.context.quarters.get(input.ticker) ?? [], {
    asOf: input.context.day,
  })
  const filed: readonly EvidenceDraft[] = [
    ...(history?.years ?? [])
      .slice(-SHOWN_YEARS)
      .flatMap((year) => toAccountsDrafts(`FY${year.fiscalYear}`, year, year.publishedOn)),
    ...(history?.trailing === undefined ? [] : toTrailingDrafts(history.trailing)),
  ]

  return {
    kind: 'accounts',
    drafts: [...filed, ...(surprise === undefined ? [] : [toSurpriseDraft(surprise)])],
    missing: filed.length === 0,
    ...(surprise === undefined ? {} : { surprise }),
  }
}

function toTrailingDrafts(trailing: TrailingAccounts): readonly EvidenceDraft[] {
  return toAccountsDrafts(
    `Four quarters to Q${trailing.quarter} ${trailing.fiscalYear}`,
    trailing,
    trailing.publishedOn
  )
}

/** None when the period carries no figure this prints, so no item stands empty. */
function toAccountsDrafts(label: string, figures: Figures, day: string): readonly EvidenceDraft[] {
  const facts = YEAR_FIGURES.flatMap(({ field, label: name, unit }) => {
    const value = figures[field]

    return value === undefined ? [] : [`${name} ${toFigureText(value, unit)}`]
  })

  return facts.length === 0
    ? []
    : [{ kind: 'accounts', origin: 'accounts', text: `${label}: ${facts.join(', ')}`, day }]
}

function toFigureText(value: number, unit: YearFigure['unit']): string {
  if (unit === 'billions') {
    return formatBillions(value)
  }

  return unit === 'level' ? formatLevel(value) : formatFigure(value)
}

function toSurpriseDraft(surprise: EarningsSurprise): EvidenceDraft {
  const facts = [
    `Q${surprise.quarter} ${surprise.fiscalYear} net profit ${formatBillions(surprise.profit)} against ${formatBillions(surprise.yearAgoProfit)} a year earlier`,
    ...(surprise.growth === undefined ? [] : [`${formatShare(surprise.growth)} year on year`]),
    ...(surprise.standardized === undefined
      ? []
      : [
          `a change ${formatFigure(surprise.standardized)} standard deviations from its usual year-on-year change`,
        ]),
  ]

  return {
    kind: 'accounts',
    origin: 'earnings-surprise',
    text: facts.join(', '),
    day: surprise.publishedOn,
  }
}

/** The news source keeps only its last two weeks, so the count is that window's. A story
 *  syndicated under one title counts once. */
export async function readHeadlinesPart(
  deps: ChainDeps,
  input: CompanyInput
): Promise<HeadlinesPart> {
  const result = await deps.marketData.news({
    ticker: input.ticker,
    market: THEME_MARKET,
    limit: SURFACE_LIMITS.maximumNewsItems,
    now: input.request.now,
    signal: input.request.signal,
  })
  const items = toStories(result.kind === 'available' ? result.value : [])

  return {
    kind: 'headlines',
    drafts: items.slice(0, SHOWN_HEADLINES).map(toHeadlineDraft),
    missing: result.kind !== 'available',
    ...(result.kind === 'available' ? { recent: items.length } : {}),
  }
}

/** Newest first, one item per story. */
function toStories(items: readonly NewsItem[]): readonly NewsItem[] {
  const stories = new Map<string, NewsItem>()

  for (const item of items.toSorted((left, right) => right.publishedAt - left.publishedAt)) {
    const key = toStoryKey(item)

    if (!stories.has(key)) {
      stories.set(key, item)
    }
  }

  return [...stories.values()]
}

function toHeadlineDraft(item: NewsItem): EvidenceDraft {
  return {
    kind: 'headlines',
    origin: URL.canParse(item.url) ? new URL(item.url).hostname : item.url,
    text: item.title,
    day: utcDayOf(item.publishedAt),
  }
}
