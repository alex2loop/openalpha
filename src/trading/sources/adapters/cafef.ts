// Source class: scraping-risky. `cafef.vn` is a consumer finance site's own AJAX handler with no
// SLA -- like `vndirect/` and `vietcap`, it can change or refuse traffic without notice. The
// endpoint is code-owned because it is a provider fact, not an operator judgment.
import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { ProprietaryFlow } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import { ValidationError } from '@/core/errors'
import { currencyCode, ticker, tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, nonNegative, pageRows, parseRow } from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

export const CAFEF_DEFAULT_ENDPOINT = 'https://cafef.vn'

const CAFEF_ID = sourceId('cafef')
const VND = currencyCode('VND')
const DESK_PATH = '/du-lieu/Ajax/PageNew/DataHistory/GDTuDoanh.ashx'
/** One row per session, so a page this size answers any window a caller asks for in one request. */
const PAGE_SIZE = 250
const ROW_DAY_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/

/** The board's own field names, whose casing differs between the two legs. */
const DESK_ROW = z.object({
  Symbol: z.string().min(1),
  Date: z.string().min(1),
  KLcpMua: z.number(),
  KlcpBan: z.number(),
  GtMua: z.number(),
  GtBan: z.number(),
})

/** An unknown symbol is an empty list inside this envelope, not a status — so only the envelope
 *  failing to parse is drift, and it throws rather than reading as a name with no history. */
const DESK_PAGE = z.object({
  Data: z.object({ Data: z.object({ ListDataTudoanh: z.array(z.unknown()) }) }),
})

export function createCafefSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [proprietaryFlowsSource(options)]
}

/** One name at a time: the handler refuses a request carrying no symbol and has no market-wide
 *  form, so a sweep costs one request per name. */
function proprietaryFlowsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: CAFEF_ID,
    kind: 'proprietaryFlows',
    format: 'json',
    http: options.http,
    covers: (context: SourceContext) =>
      context.instrument !== undefined &&
      context.fromDay !== undefined &&
      context.toDay !== undefined,
    request: (context) => {
      const { instrument, fromDay, toDay } = context

      if (instrument === undefined || fromDay === undefined || toDay === undefined) {
        return null
      }

      return {
        path: DESK_PATH,
        query: {
          Symbol: instrument.ticker,
          StartDate: toQueryDay(fromDay),
          EndDate: toQueryDay(toDay),
          PageSize: String(PAGE_SIZE),
        },
      }
    },
    paged: { pageSize: PAGE_SIZE, pageParam: 'PageIndex', extractRows: deskRows },
    parse: (raw, context, fetchedAt) =>
      parsedSource(
        dropInvalid(pageRows(raw), (row) =>
          toProprietaryFlow(row, resolveRowTarget(context, fetchedAt))
        )
      ),
  })
}

/** The handler reads its window as `MM/DD/YYYY` while every row it answers with is `DD/MM/YYYY`.
 *  Both conversions sit in this file so the two orders can never be read as one. */
function toQueryDay(day: TradingDay): string {
  const [year, month, date] = day.split('-')

  return `${month}/${date}/${year}`
}

function deskRows(raw: unknown): readonly unknown[] {
  return DESK_PAGE.parse(raw).Data.Data.ListDataTudoanh
}

function toProprietaryFlow(raw: unknown, target: RowTarget): ProprietaryFlow {
  const row = parseRow(DESK_ROW, raw, 'cafef proprietary desk')
  const bought = nonNegative(row.GtMua, 'buy value')
  const sold = nonNegative(row.GtBan, 'sell value')
  const usable =
    isCoherentLeg(bought, nonNegative(row.KLcpMua, 'buy volume')) &&
    isCoherentLeg(sold, nonNegative(row.KlcpBan, 'sell volume'))

  return {
    instrument: { market: target.market, ticker: ticker(row.Symbol) },
    at: parseRowDay(row.Date),
    currency: VND,
    // Already VND on this board, unlike the prices beside it. No THOUSAND_VND_PER_UNIT here.
    ...(usable ? { netValue: bought - sold } : {}),
    sourceId: CAFEF_ID,
    fetchedAt: target.fetchedAt,
  }
}

/** A leg states a value and the shares it was traded in, so exactly one of the two being zero is a
 *  row the board built wrong: it publishes sessions carrying the sell value under the buy field
 *  with the sell zeroed, and others carrying a value against no volume. Measured over 475 sessions
 *  the two providers both cover, a coherent row's net matches the flows provider 418 times in 447
 *  and an incoherent one 11 times in 28, so the figure is withheld. The row itself stays: a desk
 *  whose print could not be read is not a desk that stood aside, and only the row tells them
 *  apart. */
function isCoherentLeg(value: number, volume: number): boolean {
  return (value === 0) === (volume === 0)
}

function parseRowDay(raw: string): TradingDay {
  const match = ROW_DAY_RE.exec(raw)

  if (match === null) {
    throw new ValidationError('cafef desk row carries no readable date')
  }

  const [, date, month, year] = match

  return tradingDay(`${year}-${month}-${date}`)
}
