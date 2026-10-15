import { z } from 'zod'

import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  canonicalUrl,
  dropInvalid,
  NEWS_MAXIMUM_AGE_MS,
  pageRows,
  parseRow,
  publishedAt,
  untrustedText,
} from '@/trading/sources/rows/normalization'

const NEWS_ROW = z.object({
  newsTitle: z.string().min(1),
  newsUrl: z.string().min(1),
  newsDate: z.string().min(1),
  newsTime: z.string().min(1).optional(),
  newsAbstract: z.string().optional(),
})

/** Unprojected, every row also carries the full article body: 21x the payload, never stored. */
const NEWS_FIELDS = 'newsTitle,newsUrl,newsDate,newsTime,newsAbstract'
/** Day-granular and non-unique, so this adapter reads one page: offset paging over it re-emits
 *  rows across the boundary. */
const NEWS_SORT = 'newsDate'
/** Vietnam holds a fixed offset, so a row's day and time compose into an instant without a
 *  formatter. */
const VN_UTC_OFFSET = '+07:00'
const START_OF_DAY = '00:00:00'
const MAXIMUM_RECORDS = 50

export function newsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'news',
    format: 'json',
    http: options.http,
    // What this endpoint is better at than a publisher feed: one name's coverage, filings included,
    // where a market-wide read of it is mostly ministry and provincial press releases.
    covers: (context) => context.instrument !== undefined,
    request: (context) =>
      context.instrument === undefined
        ? null
        : {
            path: '/v4/news',
            query: {
              // Every group: a filing about the named company — a buyback, an insider transaction,
              // a change in voting shares — is the catalyst being asked for.
              q: `tagCodes:${context.instrument.ticker}`,
              sort: NEWS_SORT,
              fields: NEWS_FIELDS,
              size: String(Math.min(context.limit ?? MAXIMUM_RECORDS, MAXIMUM_RECORDS)),
            },
          },
    parse: (raw, _context, fetchedAt) => toNewsItems(pageRows(raw), fetchedAt),
  })
}

function toNewsItems(rows: readonly unknown[], now: number): ParsedSource<readonly NewsItem[]> {
  const parsed = dropInvalid(rows, (row) => toNewsItem(row, now))

  return parsedSource(
    parsed.map((entry) => entry.value),
    parsed.flatMap((entry) => entry.caveats)
  )
}

function toNewsItem(raw: unknown, now: number): ParsedSource<NewsItem> {
  const row = parseRow(NEWS_ROW, raw, 'vndirect news')
  const sanitized = untrustedText(row.newsTitle, 'title')
  // The abstract reaches a persona prompt as authoritative text, so it earns the same scan the
  // title gets rather than a bare trim.
  const abstract =
    row.newsAbstract === undefined ? undefined : untrustedText(row.newsAbstract, 'summary')
  const summary = abstract?.value.trim()
  const publishedIso = `${row.newsDate}T${row.newsTime ?? START_OF_DAY}${VN_UTC_OFFSET}`

  return parsedSource(
    {
      title: sanitized.value,
      url: canonicalUrl(row.newsUrl),
      publishedAt: publishedAt(publishedIso, now, NEWS_MAXIMUM_AGE_MS),
      sourceIds: [VNDIRECT_ID],
      ...(summary ? { summary } : {}),
    },
    [...sanitized.caveats, ...(abstract?.caveats ?? [])]
  )
}
