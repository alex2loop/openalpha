// Source class: first-party and keyless. PNJ's storefront prices its own board from a plain JSON
// edge endpoint — no credential, no challenge, and a publish stamp of its own.
import { z } from 'zod'

import type { VnGoldForm } from '@/trading/kernel/instrument'
import type { GoldBoard, GoldBoardRow } from '@/trading/kernel/market/market-data'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { resolveLocalTimeAt } from '@/trading/markets/calendar'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  assembleGoldBoard,
  toGoldBoardRow,
  VN_BOARD_TIMEZONE,
} from '@/trading/sources/rows/gold-board'
import {
  dayFromEpochSeconds,
  dropInvalid,
  fromCodeTable,
  TEN_THOUSAND_VND_PER_UNIT,
} from '@/trading/sources/rows/normalization'

const PNJ_ID = sourceId('pnj')
export const PNJ_DEFAULT_ENDPOINT = 'https://edge-api.pnj.io'
const BOARD_PATH = '/ecom-frontend/v1/get-gold-price'

// The ring PNJ mints, and the SJC bar it resells at SJC's own price. The route puts `giavang` first,
// so this bar row prices only a board that vendor did not answer.
const PRODUCT_FORMS: Readonly<Record<string, VnGoldForm>> = Object.freeze({
  N24K: 'pnj-ring',
  SJC: 'sjc-bar',
})

/** `dd/MM/yyyy HH:mm:ss` on the board's own Hanoi clock. Fixed width, so the day and the minute are
 *  read off by position once the shape is proven. */
const UPDATE_DATE_RE = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/

// Prices stay `unknown` so one row cannot fail the board: PNJ buys raw material without selling it
// and publishes those rows with an empty sell price. `toGoldBoardRow` is what a price must satisfy,
// and it rejects per row.
const RESPONSE = z.object({
  updateDate: z.string().min(1),
  data: z.array(
    z.object({
      masp: z.string().min(1),
      giamua: z.unknown(),
      giaban: z.unknown(),
    })
  ),
})

type ProductRow = z.infer<typeof RESPONSE>['data'][number]

export function createPnjSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createSource({
      id: PNJ_ID,
      kind: 'goldBoard',
      format: 'json',
      http: options.http,
      covers: () => true,
      request: () => ({ path: BOARD_PATH }),
      parse: (raw, _context, fetchedAt) => parseBoard(raw, fetchedAt),
      observedAt: (value) => value.observedAt,
    }),
  ]
}

function parseBoard(raw: unknown, fetchedAt: number): ParsedSource<GoldBoard> {
  const response = RESPONSE.parse(raw)
  const observedAt = resolveObservedAt(response.updateDate)

  return parsedSource(
    assembleGoldBoard(
      {
        sourceId: PNJ_ID,
        fetchedAt,
        observedAt,
        asOf: dayFromEpochSeconds(observedAt / MS_PER_SECOND, VN_BOARD_TIMEZONE),
      },
      dropInvalid(response.data, toRow)
    )
  )
}

/** The board publishes when it was priced, so the stamp is the vendor's and not our fetch's — a
 *  board left standing over a holiday reads as stale rather than as current. */
function resolveObservedAt(raw: string): number {
  if (!UPDATE_DATE_RE.test(raw)) {
    throw new ValidationError('pnj updateDate is not a dd/MM/yyyy clock')
  }

  return resolveLocalTimeAt(
    tradingDay(`${raw.slice(6, 10)}-${raw.slice(3, 5)}-${raw.slice(0, 2)}`),
    raw.slice(11, 16),
    VN_BOARD_TIMEZONE
  )
}

function toRow(raw: ProductRow): GoldBoardRow {
  const form = fromCodeTable(PRODUCT_FORMS, raw.masp)

  if (form === undefined) {
    throw new ValidationError('not a quoted gold form')
  }

  return toGoldBoardRow({
    form,
    vendor: PNJ_ID,
    buy: raw.giamua,
    sell: raw.giaban,
    priceScale: TEN_THOUSAND_VND_PER_UNIT,
  })
}
