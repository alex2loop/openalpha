// Source class: free, official. The State Bank's rate page as published HTML. A page whose wording
// changes fails the parse and writes nothing; no value is ever guessed.

import type { InterbankTenor, PolicyRateSnapshot } from '@/trading/kernel/market/policy-rates'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { INTERBANK_TENORS } from '@/trading/kernel/market/policy-rates'
import { parseVnNumber } from '@/trading/kernel/market/vn-number'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { htmlToText } from '@/trading/sources/rows/html-text'

const SBV_ID = sourceId('sbv')
/** `/vi/lãi-suất1`, percent-encoded: the transport sends the path as written. */
const RATE_PAGE_PATH = '/vi/l%C3%A3i-su%E1%BA%A5t1'
const REFINANCING_RE = /Lãi suất tái cấp vốn\s+(\d+,\d+)%/
const REDISCOUNT_RE = /Lãi suất tái chiết khấu\s+(\d+,\d+)%/
const INTERBANK_DAY_RE =
  /Lãi suất thị trường liên ngân hàng\s+Ngày áp dụng:\s*(\d{2})\/(\d{2})\/(\d{4})/
const INTERBANK_TENOR_RES: Readonly<Record<InterbankTenor, RegExp>> = Object.freeze({
  overnight: /Qua đêm\s+(\d+,\d+)/,
  '1w': /\s1 Tuần\s+(\d+,\d+)/,
  '1m': /\s1 Tháng\s+(\d+,\d+)/,
  '3m': /\s3 Tháng\s+(\d+,\d+)/,
})

export const SBV_DEFAULT_ENDPOINT = 'https://sbv.gov.vn'

function toRate(text: string, re: RegExp, label: string): number {
  const raw = re.exec(text)?.[1]

  if (raw === undefined) {
    throw new ValidationError(`sbv rate page has no ${label}`)
  }

  return parseVnNumber(raw)
}

function toInterbankDay(text: string): PolicyRateSnapshot['interbankDay'] {
  const match = INTERBANK_DAY_RE.exec(text)

  if (match === null) {
    throw new ValidationError('sbv rate page has no interbank day')
  }

  const [, day, month, year] = match

  return tradingDay(`${year}-${month}-${day}`)
}

function toInterbankRates(text: string): PolicyRateSnapshot['interbankPct'] {
  let rates: Partial<Record<InterbankTenor, number>> = {}

  for (const tenor of INTERBANK_TENORS) {
    const raw = INTERBANK_TENOR_RES[tenor].exec(text)?.[1]

    if (raw !== undefined) {
      rates = { ...rates, [tenor]: parseVnNumber(raw) }
    }
  }

  return rates
}

function toSnapshot(raw: unknown, fetchedAt: number): PolicyRateSnapshot {
  if (typeof raw !== 'string') {
    throw new ValidationError('sbv rate page did not return text')
  }

  const text = htmlToText(raw)

  return {
    refinancingPct: toRate(text, REFINANCING_RE, 'refinancing rate'),
    rediscountPct: toRate(text, REDISCOUNT_RE, 'rediscount rate'),
    interbankDay: toInterbankDay(text),
    interbankPct: toInterbankRates(text),
    sourceId: SBV_ID,
    fetchedAt,
  }
}

export function createSbvSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createSource({
      id: SBV_ID,
      kind: 'policyRates',
      format: 'text',
      http: options.http,
      covers: () => true,
      request: () => ({ path: RATE_PAGE_PATH }),
      parse: (raw, _context, fetchedAt) => parsedSource(toSnapshot(raw, fetchedAt)),
    }),
  ]
}
