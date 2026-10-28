import { z } from 'zod'

import type { IndexContribution } from '@/trading/kernel/market/index-reading'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { ticker } from '@/trading/kernel/instrument'
import {
  contextIndex,
  VNDIRECT_MKW_ID,
  VNDIRECT_MKW_REFERER,
} from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  nonNegative,
  pageRows,
  parseRow,
  THOUSAND_VND_PER_UNIT,
  toScaledPrice,
} from '@/trading/sources/rows/normalization'

/** A board a person is waiting on: one try, and an answer late enough to be stale is no answer. */
const CONTRIBUTORS_ATTEMPT_TIMEOUT_MS = 4_000
/** The provider's own widget drops the names that moved an index by less than this: rounding. */
const MINIMUM_CONTRIBUTION_POINTS = 0.005
const CONTRIBUTION_ROW = z.object({
  symbol: z.string().min(1),
  price: z.number().finite(),
  point: z.number().finite(),
})

/** What each name added to one index this session. The feed takes no date: it serves the session
 *  running, and the last one finished until the next opens, so the caller dates it. */
export function indexContributorsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_MKW_ID,
    kind: 'indexContributors',
    format: 'json',
    http: options.http,
    covers: (context) => contextIndex(context) !== undefined,
    request: (context) => {
      const index = contextIndex(context)

      return index === undefined
        ? null
        : {
            path: '/leaderlarger',
            query: { index },
            headers: { referer: VNDIRECT_MKW_REFERER },
            attemptTimeoutMs: CONTRIBUTORS_ATTEMPT_TIMEOUT_MS,
            maxAttempts: 1,
          }
    },
    parse: (raw, context, fetchedAt) => {
      const index = contextIndex(context)
      const rows = pageRows(raw)
      const contributions = dropInvalid(rows, toContribution)

      // An empty list is a quiet session; a list no row of which parses is a feed that changed shape.
      if (index === undefined || (contributions.length === 0 && rows.length > 0)) {
        throw new ValidationError('vndirect index contributors match no known shape')
      }

      return parsedSource({
        index,
        rows: contributions.filter((row) => Math.abs(row.point) >= MINIMUM_CONTRIBUTION_POINTS),
        sourceId: VNDIRECT_MKW_ID,
        fetchedAt,
      })
    },
  })
}

function toContribution(raw: unknown): IndexContribution {
  const row = parseRow(CONTRIBUTION_ROW, raw, 'vndirect index contributor')

  return {
    ticker: ticker(row.symbol),
    point: row.point,
    price: toScaledPrice(nonNegative(row.price, 'price'), THOUSAND_VND_PER_UNIT),
  }
}
