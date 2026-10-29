import { z } from 'zod'

import type { Locale } from '@/core/types/locale'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { formatNumber } from '@/trading/render/number'
import { DEFAULT_PAGE_SIZE, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  fromCodeTable,
  pageRows,
  parseRow,
  untrustedText,
} from '@/trading/sources/rows/normalization'

// Every event is published per language; the operator reads Vietnamese, so the VN edition wins.
const EVENT_LOCALE = 'VN'
// The provider states a share ratio as new shares per this many held.
const RATIO_BASE = 100
// The VN edition still writes `2,250,000 CP` and `10000 đ/cp`, so its figures are regrouped the
// Vietnamese way. A bare number is only touched before `đ/cp`: elsewhere it is a year.
const NOTE_LOCALE: Locale = 'vi'
const COMMA_GROUPED_RE = /\d{1,3}(?:,\d{3})+(?![\d,])/g
const BARE_PRICE_RE = /\d{4,}(?= ?đ\/cp)/gi

// `effectiveDate` is required on purpose: it is the day the event acts on the price, and a row
// without one is dropped rather than dated by `disclosureDate`, which is when it was announced —
// often months earlier, and wrong on a trading calendar in a way nothing downstream could detect.
const EVENT_ROW = z.object({
  code: z.string().min(1),
  id: z.union([z.string(), z.number()]),
  type: z.string().min(1),
  effectiveDate: z.string().min(1),
  typeDesc: z.string().min(1),
  note: z.string().optional(),
  dividend: z.number().positive().optional(),
  actualDate: z.string().min(1).optional(),
  ratio: z.number().positive().optional(),
  price: z.number().positive().optional(),
})

/** Mapped to the closed `MarketEventKind` union. An unmapped code is dropped rather than widened to
 *  a catch-all: an event the pipeline cannot reason about is noise in a brief. */
const EVENT_KINDS = Object.freeze({
  DIVIDEND: 'dividend-ex-date',
  STOCKDIV: 'split',
  KINDDIV: 'split',
  ISSUE: 'rights-issue',
  LISTED: 'additional-listing',
  MEETING: 'agm',
  meetingRight: 'meeting-ex-date',
  eligibleMargin: 'margin-eligible',
  nomargin: 'margin-ineligible',
  listedHose: 'listing',
  listedUpcom: 'listing',
  delistedHose: 'delisting',
  delistedUpcom: 'delisting',
  lastTradeHose: 'last-trading-day',
  lastTradeUpcom: 'last-trading-day',
} as const satisfies Readonly<Record<string, MarketEventKind>>)

export function eventsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'events',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    // `locale` is filtered at the provider because every event is published once per language;
    // taking one here is what keeps a single event from arriving twice.
    request: (context) =>
      context.instrument && context.fromDay && context.toDay
        ? {
            path: '/v4/events',
            query: {
              sort: 'effectiveDate',
              q: [
                `code:${context.instrument.ticker}`,
                `locale:${EVENT_LOCALE}`,
                `effectiveDate:gte:${context.fromDay}`,
                `effectiveDate:lte:${context.toDay}`,
              ].join('~'),
              size: String(DEFAULT_PAGE_SIZE),
            },
          }
        : null,
    paged: { pageSize: DEFAULT_PAGE_SIZE, extractRows: pageRows },
    parse: (raw) => toMarketEvents(pageRows(raw)),
  })
}

function toMarketEvents(rows: readonly unknown[]): ParsedSource<readonly MarketEvent[]> {
  const parsed = dropInvalid(rows, toMarketEvent)

  return parsedSource(
    parsed.map((entry) => entry.value),
    parsed.flatMap((entry) => entry.caveats)
  )
}

function toMarketEvent(raw: unknown): ParsedSource<MarketEvent> {
  const row = parseRow(EVENT_ROW, raw, 'vndirect event')
  const kind = kindFor(row.type)

  if (!kind) {
    throw new ValidationError(`vndirect event type ${row.type} has no mapped kind`)
  }

  const title = untrustedText(row.typeDesc, 'typeDesc')
  const detail = row.note === undefined ? undefined : untrustedText(row.note, 'note')
  const caveats: Caveat[] = [...title.caveats, ...(detail?.caveats ?? [])]

  return parsedSource(
    {
      at: tradingDay(row.effectiveDate),
      kind,
      providerEventId: String(row.id),
      title: title.value,
      ...(detail === undefined ? {} : { detail: toVietnameseFigures(detail.value) }),
      ...termsOf(kind, row),
    },
    caveats
  )
}

type EventTerms = Pick<MarketEvent, 'cashPerShare' | 'paysOn' | 'shareRatio' | 'subscriptionPrice'>

/** The terms that move the reference price. `ratio` is new shares per 100 held, and `actualDate` the
 *  payment day: a row without one states the rest and leaves it open. */
function termsOf(kind: MarketEventKind, row: z.infer<typeof EVENT_ROW>): EventTerms {
  const shareRatio = row.ratio === undefined ? {} : { shareRatio: row.ratio / RATIO_BASE }

  switch (kind) {
    case 'dividend-ex-date':
      return {
        ...(row.dividend === undefined ? {} : { cashPerShare: row.dividend }),
        ...(row.actualDate === undefined ? {} : { paysOn: tradingDay(row.actualDate) }),
      }
    case 'split':
      return shareRatio
    case 'rights-issue':
      return { ...shareRatio, ...(row.price === undefined ? {} : { subscriptionPrice: row.price }) }
    default:
      return {}
  }
}

function toVietnameseFigures(note: string): string {
  const regroup = (digits: string) => formatNumber(NOTE_LOCALE, 'count', Number(digits))

  return note
    .replace(COMMA_GROUPED_RE, (figure) => regroup(figure.replaceAll(',', '')))
    .replace(BARE_PRICE_RE, regroup)
}

function kindFor(type: string): MarketEventKind | undefined {
  return fromCodeTable(EVENT_KINDS, type)
}
