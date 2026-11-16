import { z } from 'zod'

import type { InstrumentKind, Ticker } from '@/trading/kernel/instrument'
import type { FundamentalSnapshot, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { ticker } from '@/trading/kernel/instrument'
import { getNasdaqData, NASDAQ_ID, USD } from '@/trading/sources/adapters/nasdaq/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  canonicalSector,
  dropInvalid,
  parseRow,
  positive,
  untrustedText,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

/** The whole stock list measured 2.19 MB against the 2.10 MB response cap, so it is asked one
 *  exchange at a time. */
const STOCK_EXCHANGES = Object.freeze(['NASDAQ', 'NYSE', 'AMEX'] as const)

const STOCK_PATH = '/api/screener/stocks'
const ETF_PATH = '/api/screener/etf'

/** Nasdaq lists a class share as `BRK/B`; its quote and bar endpoints answer `BRK.B`. */
const CLASS_SHARE_RE = /^([A-Z]+)\/([A-Z])$/

/** The wording a security that is not a share of the company carries in its name. The stock list
 *  also holds a company's warrants, preferred depositary shares, notes, bonds and units under their
 *  own tickers, each stamped with the parent's market cap, so the symbol cannot tell them apart:
 *  `OXY.WS` and `TBB` look like names. Matched inside the lowercased name, with the leading space
 *  where a bare word sits inside a company ("BrightSpring"). */
const NON_COMMON_NAME_MARKERS: readonly string[] = [
  'warrant',
  ' rights',
  ' notes',
  'bonds',
  'debentures',
  'zones',
  'strats',
  'corporate unit',
  'equity unit',
  'preferred stock',
  'preferred unit',
  'preferred series',
  'preferred class',
  'term preferred',
  'trust preferred',
  'preference share',
  'cumulative',
]

/** A bare "depositary shares" name is a preferred's, unless it is a depositary receipt of a foreign
 *  company's shares ("American Depositary Shares each representing two Ordinary Shares"), which is a
 *  share. The receipt wording rescues only these markers: a warrant over such receipts stays dropped. */
const DEPOSITARY_SHARES_NAME_MARKERS: readonly string[] = ['depositary shares', 'depository shares']

const DEPOSITARY_RECEIPT_NAME_MARKERS: readonly string[] = [
  'american depositary',
  'american depository',
  'global depositary',
]

const STOCK_TABLE = z.object({ rows: z.array(z.unknown()) })
const ETF_TABLE = z.object({ data: z.object({ rows: z.array(z.unknown()) }) })

const STOCK_ROW = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  marketCap: z.string().optional(),
  sector: z.string().optional(),
})

const ETF_ROW = z.object({
  symbol: z.string().min(1),
  companyName: z.string().min(1),
})

interface ScreenerLeg {
  readonly kind: InstrumentKind
  readonly exchange?: string
  readonly rows: readonly unknown[]
}

export function nasdaqInstrumentsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: NASDAQ_ID,
    kind: 'instruments',
    http: options.http,
    covers: (context) => context.instrument === undefined,
    load: async (context, signal) => {
      const legs = await readLegs(options.http, signal, true)

      return legs.kind === 'error'
        ? legs
        : { ...legs, value: toInstruments(legs.value, resolveRowTarget(context, legs.fetchedAt)) }
    },
  })
}

export function nasdaqFundamentalsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: NASDAQ_ID,
    kind: 'fundamentals',
    http: options.http,
    covers: (context) => context.instrument === undefined && context.toDay !== undefined,
    load: async (context, signal) => {
      const legs = await readLegs(options.http, signal, false)

      return legs.kind === 'error'
        ? legs
        : { ...legs, value: toFundamentals(legs.value, context, legs.fetchedAt) }
    },
  })
}

/** A failed leg fails the read: a partial scope would delist the names the missing leg held. */
async function readLegs(
  http: SourceHttp,
  signal: AbortSignal,
  withEtfs: boolean
): Promise<SourceFetchOutcome<readonly ScreenerLeg[]>> {
  const outcomes = await Promise.all([
    ...STOCK_EXCHANGES.map((exchange) => readStockLeg(http, exchange, signal)),
    ...(withEtfs ? [readEtfLeg(http, signal)] : []),
  ])
  const failed = outcomes.find((outcome) => outcome.kind === 'error')

  if (failed?.kind === 'error') {
    return failed
  }

  return {
    kind: 'ok',
    value: outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? [outcome.value] : [])),
    fetchedAt: Math.max(
      ...outcomes.map((outcome) => (outcome.kind === 'ok' ? outcome.fetchedAt : 0))
    ),
  }
}

function readStockLeg(
  http: SourceHttp,
  exchange: string,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ScreenerLeg>> {
  return getNasdaqData(
    http,
    {
      path: STOCK_PATH,
      query: { tableonly: 'true', download: 'true', exchange: exchange.toLowerCase() },
      signal,
    },
    (data) => ({ kind: 'equity', exchange, rows: STOCK_TABLE.parse(data).rows })
  )
}

function readEtfLeg(
  http: SourceHttp,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ScreenerLeg>> {
  return getNasdaqData(
    http,
    { path: ETF_PATH, query: { tableonly: 'true', download: 'true' }, signal },
    (data) => ({ kind: 'etf', rows: ETF_TABLE.parse(data).data.rows })
  )
}

/** Dropped, not repaired: a `^` marks a preferred and any other `/` a unit or warrant, none of which
 *  the quote and bar endpoints answer. */
function toListingTicker(symbol: string): Ticker {
  const share = CLASS_SHARE_RE.exec(symbol)

  if (share !== null) {
    return ticker(`${share[1]}.${share[2]}`)
  }

  if (symbol.includes('^') || symbol.includes('/')) {
    throw new ValidationError(`${symbol} is not a plain listing`)
  }

  return ticker(symbol)
}

function toInstruments(
  legs: readonly ScreenerLeg[],
  target: RowTarget
): ParsedSource<readonly InstrumentRecord[]> {
  const byTicker = new Map<Ticker, InstrumentRecord>()

  for (const leg of legs) {
    const parsed = dropInvalid(leg.rows, (row) => toInstrument(row, leg, target))

    for (const record of parsed) {
      if (!byTicker.has(record.instrument.ticker)) {
        byTicker.set(record.instrument.ticker, record)
      }
    }
  }

  return parsedSource([...byTicker.values()])
}

function toInstrument(raw: unknown, leg: ScreenerLeg, target: RowTarget): InstrumentRecord {
  const row =
    leg.kind === 'etf'
      ? toEtfFields(parseRow(ETF_ROW, raw, 'nasdaq etf'))
      : toStockFields(parseStockRow(raw))
  const sector = row.sector === undefined ? undefined : canonicalSector(row.sector)

  return {
    instrument: { market: target.market, ticker: toListingTicker(row.symbol) },
    // A listed name reaches a model through screens and briefs, like a headline does.
    name: untrustedText(row.name, 'name').value,
    kind: leg.kind,
    status: 'active',
    currency: USD,
    ...(leg.exchange === undefined ? {} : { exchange: leg.exchange }),
    ...(sector === undefined ? {} : { sector }),
    sourceId: NASDAQ_ID,
    fetchedAt: target.fetchedAt,
  }
}

interface ListingFields {
  readonly symbol: string
  readonly name: string
  readonly sector?: string
}

function toStockFields(row: z.infer<typeof STOCK_ROW>): ListingFields {
  return { symbol: row.symbol, name: row.name, ...(row.sector ? { sector: row.sector } : {}) }
}

function toEtfFields(row: z.infer<typeof ETF_ROW>): ListingFields {
  return { symbol: row.symbol, name: row.companyName }
}

function toFundamentals(
  legs: readonly ScreenerLeg[],
  context: SourceContext,
  fetchedAt: number
): ParsedSource<readonly FundamentalSnapshot[]> {
  const target = resolveRowTarget(context, fetchedAt)
  const wanted = context.tickers === undefined ? undefined : new Set<Ticker>(context.tickers)
  const snapshots = legs.flatMap((leg) =>
    dropInvalid(leg.rows, (row) => toSnapshot(row, context, target))
  )

  return parsedSource(
    snapshots.filter((snapshot) => wanted === undefined || wanted.has(snapshot.instrument.ticker))
  )
}

function toSnapshot(raw: unknown, context: SourceContext, target: RowTarget): FundamentalSnapshot {
  const row = parseStockRow(raw)

  if (context.toDay === undefined) {
    throw new ValidationError('fundamentals need a day')
  }

  return {
    instrument: { market: target.market, ticker: toListingTicker(row.symbol) },
    asOf: context.toDay,
    currency: USD,
    // An empty or zero cap is an unlisted figure: absent, so the name drops out instead of ranking last.
    marketCap: positive(Number(row.marketCap), 'marketCap'),
    sourceId: NASDAQ_ID,
    fetchedAt: target.fetchedAt,
  }
}

/** Dropped, not repaired: a row that is not a share has no share price to rank on the board. */
function parseStockRow(raw: unknown): z.infer<typeof STOCK_ROW> {
  const row = parseRow(STOCK_ROW, raw, 'nasdaq stock')

  if (isNonCommonName(row.name)) {
    throw new ValidationError(`${row.symbol} is not a common security`)
  }

  return row
}

function isNonCommonName(name: string): boolean {
  const lowered = name.toLowerCase()

  return (
    includesAny(lowered, NON_COMMON_NAME_MARKERS) ||
    (includesAny(lowered, DEPOSITARY_SHARES_NAME_MARKERS) &&
      !includesAny(lowered, DEPOSITARY_RECEIPT_NAME_MARKERS))
  )
}

function includesAny(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker))
}
