import type { Caveat } from '@/trading/kernel/caveat'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AnnualAccounts,
  FiledAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDataRefreshRequest } from '@/trading/markets/types'

/** Lines that are no sum of money, kept as filed when a report changes currency. */
const UNSCALED_LINES: ReadonlySet<string> = new Set<keyof AccountLines>([
  'sharesOutstanding',
  'capitalAdequacy',
])

interface CurrencyRead {
  readonly currency: CurrencyCode
  readonly request: MarketDataRefreshRequest
}

interface ConvertedAccounts {
  readonly filed: FiledAccounts
  readonly caveats: readonly Caveat[]
}

/** A filer reporting in another currency is restated at the latest rate. Every year scales alike,
 *  so growth and ratios hold, and the newest year reads at what it is worth today, which is what its
 *  valuation is measured against. Without a rate its reports are left out, never stored in the
 *  wrong unit. */
export async function toMarketCurrency(
  deps: MarketDeps,
  filed: FiledAccounts,
  read: CurrencyRead
): Promise<ConvertedAccounts> {
  const currencies = new Set(
    filed.annual.flatMap((report) => foreignCurrencyOf(report, read) ?? [])
  )
  const quotes = await Promise.all(
    [...currencies].map(async (fromCurrency) => {
      const quote = await deps.fx.convert({
        fromCurrency,
        toCurrency: read.currency,
        asOf: read.request.asOf,
        signal: read.request.signal,
      })

      return { fromCurrency, quote }
    })
  )
  const rates = new Map(
    quotes.flatMap(({ fromCurrency, quote }) =>
      quote.kind === 'available' ? [[fromCurrency, quote.value.rate]] : []
    )
  )

  return {
    filed: { ...filed, annual: filed.annual.flatMap((report) => toStored(report, rates, read)) },
    caveats: quotes.flatMap(({ quote }) => quote.caveats),
  }
}

function toStored(
  report: AnnualAccounts,
  rates: ReadonlyMap<CurrencyCode, number>,
  read: CurrencyRead
): readonly AnnualAccounts[] {
  const { reportingCurrency: _, ...stored } = report
  const currency = foreignCurrencyOf(report, read)

  if (currency === undefined) {
    return [stored]
  }

  const rate = rates.get(currency)

  return rate === undefined ? [] : [{ ...stored, lines: toScaledLines(stored.lines, rate) }]
}

function foreignCurrencyOf(report: AnnualAccounts, read: CurrencyRead): CurrencyCode | undefined {
  return report.reportingCurrency === read.currency ? undefined : report.reportingCurrency
}

function toScaledLines(lines: AccountLines, rate: number): AccountLines {
  const scaled: { -readonly [K in keyof AccountLines]?: number } = {}

  for (const [key, value] of Object.entries(lines)) {
    if (isAccountLine(key, lines) && value !== undefined) {
      scaled[key] = UNSCALED_LINES.has(key) ? value : value * rate
    }
  }

  return scaled
}

function isAccountLine(key: string, lines: AccountLines): key is keyof AccountLines {
  return Object.hasOwn(lines, key)
}
