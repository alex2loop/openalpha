// Source class: scraping-risky. `api.nasdaq.com` is the site's own JSON backend with no SLA; it can
// change shape or refuse traffic without notice. A symbol it does not know answers HTTP 200 with
// `status.rCode` 400 in the body, so a miss is read off the envelope, not the transport status.
import { z } from 'zod'

import type { InstrumentKind, TradingDay } from '@/trading/kernel/instrument'
import type { SourceFetchOutcome, SourceHttp, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { currencyCode, tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { resolveLocalTimeAt } from '@/trading/markets/calendar'
import { fromCodeTable, parseRow } from '@/trading/sources/rows/normalization'

export const NASDAQ_DEFAULT_ENDPOINT = 'https://api.nasdaq.com'
export const NASDAQ_ID = sourceId('nasdaq')
export const USD = currencyCode('USD')
/** The clock this feed stamps its rows and its "today" on, a provider fact about the feed. */
export const NASDAQ_TIMEZONE = 'America/New_York'

const OK_CODE = 200
const MISS_CODE = 400
const HEADERS = Object.freeze({ accept: 'application/json' })

const ENVELOPE = z.object({
  data: z.unknown(),
  status: z.object({ rCode: z.number() }),
})

const AMOUNT_NOISE_RE = /[$,%+]/g
const AMOUNT_RE = /^-?\d+(\.\d+)?$/
const US_DAY_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const EASTERN_INSTANT_RE = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/
const HALF_DAY_HOURS = 12

const MONTHS = Object.freeze({
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
} as const)

const ASSET_CLASSES = Object.freeze({
  equity: 'stocks',
  etf: 'etf',
  index: 'index',
} as const satisfies Readonly<Partial<Record<InstrumentKind, string>>>)

type NasdaqRequest = Omit<SourceRequest, 'sourceId' | 'headers'>

/** The envelope's `data`, or `null` for a symbol the feed does not know. Any other refusal in the
 *  envelope is a payload this adapter cannot read. */
function unwrapData(raw: unknown): unknown {
  const envelope = parseRow(ENVELOPE, raw, 'nasdaq envelope')

  if (envelope.status.rCode === MISS_CODE) {
    return null
  }

  if (envelope.status.rCode !== OK_CODE || envelope.data === null) {
    throw new ValidationError('nasdaq envelope carries no data')
  }

  return envelope.data
}

/** One GET through the shared transport; `parse` sees the unwrapped `data`. A symbol the feed does
 *  not know is a business miss, not an outage. */
export async function getNasdaqData<T>(
  http: SourceHttp,
  request: NasdaqRequest,
  parse: (data: unknown, fetchedAt: number) => T
): Promise<SourceFetchOutcome<T>> {
  const outcome = await http.getJson<T | null>(
    { ...request, sourceId: NASDAQ_ID, headers: HEADERS },
    (raw, fetchedAt) => {
      const data = unwrapData(raw)

      return data === null ? null : parse(data, fetchedAt)
    }
  )

  if (outcome.kind === 'error') {
    return outcome
  }

  return outcome.value === null
    ? { kind: 'error', code: 'source.symbol-not-found' }
    : { ...outcome, value: outcome.value }
}

/** The `assetclass` query value for a stored kind; absent means a cash equity. */
export function assetClassOf(kind: InstrumentKind | undefined): string {
  return fromCodeTable(ASSET_CLASSES, kind ?? 'equity') ?? ASSET_CLASSES.equity
}

function parseAmount(raw: unknown, label: string): number {
  if (typeof raw !== 'string') {
    throw new ValidationError(`${label} is not text`)
  }

  const cleaned = raw.replace(AMOUNT_NOISE_RE, '')

  if (!AMOUNT_RE.test(cleaned)) {
    throw new ValidationError(`${label} is not a number`)
  }

  return Number(cleaned)
}

/** "$214.13" and an index level such as "26,425.50". */
export function parseUsd(raw: unknown): number {
  return parseAmount(raw, 'price')
}

/** "-0.16%" and "+0.30%", as a percent. */
export function parsePercent(raw: unknown): number {
  return parseAmount(raw, 'percent')
}

/** "121,252,500", or "5,749,545.123700" on a live quote. */
export function parseCount(raw: unknown): number {
  const count = parseAmount(raw, 'count')

  if (count < 0) {
    throw new ValidationError('count must not be negative')
  }

  return count
}

/** "10/16/2026". */
export function parseUsDay(raw: unknown): TradingDay {
  const match = typeof raw === 'string' ? US_DAY_RE.exec(raw) : null

  if (match === null) {
    throw new ValidationError('date is not MM/DD/YYYY')
  }

  return tradingDay(`${match[3]}-${match[1]}-${match[2]}`)
}

/** "Oct 19, 2026 12:44 PM ET", on New York's wall clock whichever side of daylight saving. */
export function parseEasternInstant(raw: unknown): number {
  const match = typeof raw === 'string' ? EASTERN_INSTANT_RE.exec(raw) : null
  const month = match === null ? undefined : fromCodeTable(MONTHS, match[1] ?? '')

  if (match === null || month === undefined) {
    throw new ValidationError('timestamp is not a New York clock')
  }

  const [, , dayOfMonth = '', year = '', hour12 = '', minute = '', half = ''] = match
  const hour = (Number(hour12) % HALF_DAY_HOURS) + (half === 'PM' ? HALF_DAY_HOURS : 0)
  const day = tradingDay(`${year}-${month}-${dayOfMonth.padStart(2, '0')}`)

  return resolveLocalTimeAt(day, `${String(hour).padStart(2, '0')}:${minute}`, NASDAQ_TIMEZONE)
}
