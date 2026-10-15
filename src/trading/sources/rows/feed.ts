// RSS and Atom entries, as every feed-reading news provider parses them: one item shape, one
// sanitize boundary, one entity decoder. The adapter owns which feed or query produced the text.

import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { ParsedSource } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { registrableDomain, stripTrailingSource } from '@/trading/markets/news'
import { parsedSource } from '@/trading/sources/define'
import { decodeEntities } from '@/trading/sources/rows/html-text'
import {
  canonicalUrl,
  dropInvalid,
  NEWS_MAXIMUM_AGE_MS,
  publishedAt,
  untrustedText,
} from '@/trading/sources/rows/normalization'

const GOOGLE_NEWS_DOMAIN = 'google.com'
const ITEM_RE = /<(item|entry)\b[\s\S]*?<\/\1>/g
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/
const LINK_RE = /<link\b[^>]*>([\s\S]*?)<\/link>/
const LINK_HREF_RE = /<link\b[^>]*\bhref="([^"]+)"/
const DATE_RE = /<(pubDate|published|updated|dc:date)\b[^>]*>([\s\S]*?)<\/\1>/
const CDATA_RE = /^<!\[CDATA\[([\s\S]*?)\]\]>$/

export function toFeedItems(
  raw: unknown,
  source: SourceId,
  now: number
): ParsedSource<readonly NewsItem[]> {
  if (typeof raw !== 'string') {
    throw new ValidationError('feed did not return text')
  }

  const parsed = dropInvalid(raw.match(ITEM_RE) ?? [], (entry) => toNewsItem(entry, source, now))

  return parsedSource(
    parsed.map((entry) => entry.value),
    parsed.flatMap((entry) => entry.caveats)
  )
}

function toNewsItem(entry: string, source: SourceId, now: number): ParsedSource<NewsItem> {
  const title = tagValue(entry, TITLE_RE, 1)
  const link = tagValue(entry, LINK_RE, 1) ?? tagValue(entry, LINK_HREF_RE, 1)
  const date = tagValue(entry, DATE_RE, 2)

  if (title === undefined || link === undefined) {
    throw new ValidationError('feed item has no title or link')
  }

  // The one boundary, so a NewsItem that exists has already been sanitized.
  const sanitized = untrustedText(title, 'title')
  const url = canonicalUrl(link)

  return parsedSource(
    {
      title: toDisplayTitle(sanitized.value, url),
      url,
      publishedAt: publishedAt(date, now, NEWS_MAXIMUM_AGE_MS),
      sourceIds: [source],
    },
    sanitized.caveats
  )
}

/** Google News echoes the publisher into every title and a publisher feed does not, so the strip
 *  reads the aggregator rather than guessing from the text. */
function toDisplayTitle(title: string, url: string): string {
  return registrableDomain(url) === GOOGLE_NEWS_DOMAIN ? stripTrailingSource(title) : title
}

function tagValue(entry: string, re: RegExp, group: number): string | undefined {
  const raw = re.exec(entry)?.[group]?.trim()

  if (raw === undefined) {
    return undefined
  }

  const cdata = CDATA_RE.exec(raw)?.[1]

  // A CDATA section is literal by definition; only escaped markup carries entities to decode.
  return (cdata === undefined ? decodeEntities(raw) : cdata).trim()
}
