import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { FlowSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { MarketRead } from '@/trading/sources/adapters/vndirect/market-read'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import {
  MARKET_PAGE_SIZE,
  marketSort,
  VND,
  VNDIRECT_ID,
} from '@/trading/sources/adapters/vndirect/client'
import { createMarketRead, readMarketWindow } from '@/trading/sources/adapters/vndirect/market-read'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, finite, nonNegative, parseRow } from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

const FOREIGN_ROW = z.object({
  code: z.string().min(1),
  tradingDate: z.string().min(1),
  buyVal: z.number(),
  sellVal: z.number(),
  netVal: z.number(),
})

// The proprietary desk is a separate endpoint keyed on `date`, not `tradingDate`.
const PROPRIETARY_ROW = z.object({
  code: z.string().min(1),
  date: z.string().min(1),
  netVal: z.number(),
})

/** Both desks answer for the whole market while a refresh only asks for shares and funds.
 *  Narrowing keeps a factor window inside `getJsonPages`' ceiling: unfiltered it measured 35 pages
 *  against a ceiling of 20. `IFC` is the listed fund certificate: omitting it left every one of
 *  them with no flow row to slice. */
const TRADEABLE_TYPES = 'STOCK,ETF,IFC'

const DESKS = Object.freeze({
  foreign: { path: '/v4/foreigns', dayField: 'tradingDate' },
  proprietary: { path: '/v4/proprietary_trading', dayField: 'date' },
} as const)

type Desk = (typeof DESKS)[keyof typeof DESKS]

/** Two desks, one snapshot: `/v4/foreigns` and `/v4/proprietary_trading` each report one leg of the
 *  same trading day, and the `proprietary-flow` factor reads the leg the foreign endpoint omits.
 *  A missing proprietary row leaves that leg unset rather than dropping the day's foreign flow. */
export function flowsSource(options: SourceAdapterOptions): RegisteredSource {
  // One slot per desk: the two are separate endpoints with separate row shapes and separate day
  // fields, so a single shared read cannot serve both.
  const foreign = createMarketRead(DESKS.foreign.dayField)
  const proprietary = createMarketRead(DESKS.proprietary.dayField)

  return createSource({
    id: VNDIRECT_ID,
    kind: 'flows',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    load: (context, signal) => loadFlows({ options, foreign, proprietary }, context, signal),
  })
}

interface FlowsDeps {
  readonly options: SourceAdapterOptions
  readonly foreign: MarketRead
  readonly proprietary: MarketRead
}

async function loadFlows(
  deps: FlowsDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly FlowSnapshot[]>>> {
  const window = flowWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const key = `${window.fromDay}|${window.toDay}`
  const pages = (desk: Desk): Promise<SourceFetchOutcome<readonly unknown[]>> =>
    readMarketWindow({
      http: deps.options.http,
      window,
      pageSize: MARKET_PAGE_SIZE,
      request: (part) => windowRequest(desk, { ...window, ...part }, signal),
    })
  const deskRequest = { key, ticker: window.ticker, signal }
  const foreign = await deps.foreign.forTicker({
    ...deskRequest,
    load: () => pages(DESKS.foreign),
  })

  if (foreign.kind === 'error') {
    return foreign
  }

  const proprietary = await deps.proprietary.forTicker({
    ...deskRequest,
    load: () => pages(DESKS.proprietary),
  })
  // Flow values are already VND. No THOUSAND_VND_PER_UNIT here — that is the bug this file's
  // separation from bars.ts (price parsing) exists to prevent.
  const proprietaryDesk: ProprietaryDesk = {
    netByDay: proprietaryNetByDay(proprietary),
    coveredDays: await deps.proprietary.coveredDays(key),
  }
  // Both legs feed the snapshot: the foreign leg alone claims a freshness the proprietary numbers
  // in it do not have.
  const fetchedAt =
    proprietary.kind === 'error'
      ? foreign.fetchedAt
      : Math.max(foreign.fetchedAt, proprietary.fetchedAt)
  const target = resolveRowTarget(context, fetchedAt)

  return {
    ...foreign,
    fetchedAt,
    value: parsedSource(
      dropInvalid(foreign.value, (row) => toFlowSnapshot(row, proprietaryDesk, target))
    ),
  }
}

interface FlowWindow {
  readonly ticker: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

function flowWindow(context: SourceContext): FlowWindow | null {
  if (!(context.instrument && context.fromDay && context.toDay)) {
    return null
  }

  return {
    ticker: context.instrument.ticker,
    fromDay: context.fromDay,
    toDay: context.toDay,
  }
}

/** Market-wide: both desks answer the whole market for a window in one query, and every ticker in a
 *  sweep asks for the same window, so no request carries a `code:` clause. */
function windowRequest(desk: Desk, window: FlowWindow, signal: AbortSignal): SourceRequest {
  const { dayField } = desk

  return {
    sourceId: VNDIRECT_ID,
    path: desk.path,
    query: {
      sort: marketSort(dayField, 'asc'),
      q: `type:${TRADEABLE_TYPES}~${dayField}:gte:${window.fromDay}~${dayField}:lte:${window.toDay}`,
      size: String(MARKET_PAGE_SIZE),
    },
    signal,
  }
}

interface ProprietaryDesk {
  readonly netByDay: ReadonlyMap<string, number>
  readonly coveredDays: ReadonlySet<string>
}

/** A failed proprietary fetch degrades the leg, never the whole snapshot: the foreign flow it would
 *  have accompanied is still the truth about that day. */
function proprietaryNetByDay(
  outcome: SourceFetchOutcome<readonly unknown[]>
): ReadonlyMap<string, number> {
  if (outcome.kind === 'error') {
    return new Map()
  }

  const rows = dropInvalid(outcome.value, (raw) =>
    parseRow(PROPRIETARY_ROW, raw, 'vndirect proprietary')
  )

  return new Map(rows.map((row) => [row.date, row.netVal]))
}

function toFlowSnapshot(raw: unknown, desk: ProprietaryDesk, target: RowTarget): FlowSnapshot {
  const row = parseRow(FOREIGN_ROW, raw, 'vndirect foreign flow')

  return {
    instrument: { market: target.market, ticker: ticker(row.code) },
    at: tradingDay(row.tradingDate),
    currency: VND,
    foreignBuyValue: nonNegative(row.buyVal, 'buyVal'),
    foreignSellValue: nonNegative(row.sellVal, 'sellVal'),
    foreignNetValue: finite(row.netVal, 'netVal'),
    ...proprietaryLeg(row.tradingDate, desk),
    sourceId: VNDIRECT_ID,
    fetchedAt: target.fetchedAt,
  }
}

/** The desks' endpoint emits a row only where a desk actually traded — roughly 90 names a session
 *  against the foreign endpoint's whole-market 1500 — so a covered day with no row for this ticker
 *  is a desk that did not trade it, which is a real zero. A day the read never covered stays unset,
 *  because a source that reported nothing must not read as a desk that traded nothing. */
function proprietaryLeg(
  day: string,
  desk: ProprietaryDesk
): Pick<FlowSnapshot, 'proprietaryNetValue'> {
  const net = desk.netByDay.get(day)

  if (net !== undefined) {
    return { proprietaryNetValue: finite(net, 'netVal') }
  }

  return desk.coveredDays.has(day) ? { proprietaryNetValue: 0 } : {}
}
