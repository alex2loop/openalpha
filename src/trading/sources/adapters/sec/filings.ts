import { z } from 'zod'

import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { OwnershipFiling } from '@/trading/sources/adapters/sec/ownership'
import type { SecTickerMap, TickerMapReader } from '@/trading/sources/adapters/sec/tickers'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { MS_PER_DAY } from '@/core/utils/time'
import { isLevelKind, tradingDay } from '@/trading/kernel/instrument'
import { SEC_CREDENTIAL, SEC_DATA_ID, SEC_ID } from '@/trading/sources/adapters/sec/client'
import { parseOwnershipXml } from '@/trading/sources/adapters/sec/ownership'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  parseRow,
  untrustedText,
  utcDayOf,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'

/** Form 4s read back from the asked day. */
const INSIDER_LOOKBACK_DAYS = 90
/** One request each, so the newest few: a name with more has been busy enough to be said so. */
const INSIDER_MAXIMUM_FILINGS = 10
const OWNERSHIP_CONCURRENCY = 4
/** 8-K item 2.02: results of operations, which is an earnings release. */
const EARNINGS_ITEM = '2.02'
/** An open-market purchase, as Form 4 codes it. Awards, exercises and gifts are not a view. */
const OPEN_MARKET_PURCHASE = 'P'
const BUSINESS_MISS_STATUSES = Object.freeze([404])
const DAY_LENGTH = 10

const SUBMISSIONS = z.object({
  filings: z.object({
    recent: z.object({
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      accessionNumber: z.array(z.string()),
      primaryDocument: z.array(z.string()),
      items: z.array(z.string()).optional(),
    }),
  }),
})

interface Filing {
  readonly form: string
  readonly day: TradingDay
  readonly accession: string
  readonly document: string
  readonly items: readonly string[]
}

interface Window {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

export function secEventsSource(
  options: SourceAdapterOptions,
  readTickers: TickerMapReader
): RegisteredSource {
  return createSource({
    id: SEC_DATA_ID,
    kind: 'events',
    http: options.http,
    covers: (context) =>
      context.instrument !== undefined &&
      context.toDay !== undefined &&
      !isLevelKind(context.instrumentKind) &&
      context.instrumentKind !== 'etf',
    load: async (context, signal) => {
      const map = await readTickers(signal)

      return map.kind === 'error'
        ? map
        : loadEvents({ http: options.http, context, map: map.value, signal })
    },
  })
}

interface EventsRead {
  readonly http: SourceHttp
  readonly context: SourceContext
  readonly map: SecTickerMap
  readonly signal: AbortSignal
}

async function loadEvents(
  read: EventsRead
): Promise<SourceFetchOutcome<ParsedSource<readonly MarketEvent[]>>> {
  const { http, context, map, signal } = read
  const cik = context.instrument === undefined ? undefined : map.get(context.instrument.ticker)

  if (cik === undefined || context.instrument === undefined || context.toDay === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const listed = await http.getJson(
    {
      sourceId: SEC_DATA_ID,
      path: `/submissions/CIK${cik}.json`,
      credential: SEC_CREDENTIAL,
      businessMissStatuses: BUSINESS_MISS_STATUSES,
      signal,
    },
    toFilings
  )

  if (listed.kind === 'error') {
    return listed
  }

  const window = { fromDay: context.fromDay ?? context.toDay, toDay: context.toDay }
  const ticker = context.instrument.ticker
  const insider = await insiderEvents(http, { cik, ticker, filings: listed.value, window, signal })

  return {
    ...listed,
    value: parsedSource([
      ...earningsEvents({ filings: listed.value, window, ticker, context }),
      ...insider,
    ]),
  }
}

function toFilings(raw: unknown): readonly Filing[] {
  const { recent } = parseRow(SUBMISSIONS, raw, 'sec submissions').filings

  return recent.form.flatMap((form, index) => {
    const day = recent.filingDate[index]
    const accession = recent.accessionNumber[index]
    const document = recent.primaryDocument[index]

    return day === undefined || accession === undefined || document === undefined
      ? []
      : [
          {
            form,
            day: tradingDay(day),
            accession,
            document,
            items: (recent.items?.[index] ?? '').split(',').map((item) => item.trim()),
          },
        ]
  })
}

function earningsEvents(read: {
  readonly filings: readonly Filing[]
  readonly window: Window
  readonly ticker: Ticker
  readonly context: SourceContext
}): readonly MarketEvent[] {
  const { filings, window, ticker, context } = read

  return filings
    .filter((filing) => filing.form === '8-K' && filing.items.includes(EARNINGS_ITEM))
    .filter((filing) => filing.day >= window.fromDay && filing.day <= window.toDay)
    .map((filing) => ({
      at: filing.day,
      kind: 'earnings-release' as const,
      title: `${ticker} 8-K item ${EARNINGS_ITEM}`,
      ...(context.instrument === undefined ? {} : { instrument: context.instrument }),
      providerEventId: filing.accession,
    }))
}

interface InsiderRead {
  readonly cik: string
  readonly ticker: Ticker
  readonly filings: readonly Filing[]
  readonly window: Window
  readonly signal: AbortSignal
}

/** Best effort: a Form 4 that cannot be read costs that filing, never the earnings events. */
async function insiderEvents(http: SourceHttp, read: InsiderRead): Promise<readonly MarketEvent[]> {
  // The lookback runs back from the earlier of the asked end and today: a run asks events out to the
  // end of its holding window, and ninety days before a day that has not come yet is no history.
  const today = utcDayOf(Date.now())
  const reach = read.window.toDay < today ? read.window.toDay : today
  const earliest = utcDayOf(utcDayStartEpochMs(reach) - INSIDER_LOOKBACK_DAYS * MS_PER_DAY)
  const from = read.window.fromDay > earliest ? read.window.fromDay : earliest
  const forms = read.filings
    .filter(
      (filing) => filing.form === '4' && filing.day >= from && filing.day <= read.window.toDay
    )
    .slice(0, INSIDER_MAXIMUM_FILINGS)
  const documents = await mapWithConcurrency(forms, OWNERSHIP_CONCURRENCY, (filing) =>
    readOwnership(http, read, filing)
  )

  return documents.flatMap((document, index) => toPurchases(document, read.ticker, forms[index]))
}

async function readOwnership(
  http: SourceHttp,
  read: InsiderRead,
  filing: Filing
): Promise<OwnershipFiling | undefined> {
  // The primary document is the stylesheet-rendered page; the raw XML sits beside it.
  const raw = filing.document.slice(filing.document.lastIndexOf('/') + 1)
  const outcome = await http.getText({
    sourceId: SEC_ID,
    path: `/Archives/edgar/data/${Number(read.cik)}/${filing.accession.replaceAll('-', '')}/${raw}`,
    credential: SEC_CREDENTIAL,
    signal: read.signal,
  })

  return outcome.kind === 'ok' ? parseOwnershipXml(outcome.value) : undefined
}

function toPurchases(
  document: OwnershipFiling | undefined,
  ticker: Ticker,
  filing: Filing | undefined
): readonly MarketEvent[] {
  if (document === undefined || filing === undefined) {
    return []
  }

  return document.transactions
    .filter((transaction) => transaction.code === OPEN_MARKET_PURCHASE)
    .map((transaction) => {
      const who =
        document.role === undefined ? document.owner : `${document.owner} (${document.role})`
      const price = transaction.price === undefined ? '' : ` at $${transaction.price}`

      return {
        at: tradingDay(transaction.day.slice(0, DAY_LENGTH)),
        kind: 'insider-purchase' as const,
        title: untrustedText(`${ticker} ${who}`, 'owner').value,
        detail: untrustedText(`${transaction.shares} shares${price}`, 'detail').value,
        providerEventId: filing.accession,
      }
    })
}
