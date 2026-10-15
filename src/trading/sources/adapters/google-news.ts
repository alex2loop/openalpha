// Source class: free, keyless. The instrument-scoped news provider for a market whose publishers
// index no symbol. The caller names its own subject, and a result that does not name it back is
// dropped — but a subject whose name is an ordinary word still draws stories about the word, which
// the topic terms narrow and cannot close. This is a search, never a symbol feed.

import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { toFeedItems } from '@/trading/sources/rows/feed'

export const GOOGLE_NEWS_DEFAULT_ENDPOINT = 'https://news.google.com'

const GOOGLE_NEWS_ID = sourceId('google-news')
const SEARCH_PATH = '/rss/search'
/** The edition searched, not a display setting: it selects both the language of the index and the
 *  regional slice of it. */
const SEARCH_LOCALE: Readonly<Record<string, string>> = Object.freeze({
  hl: 'en-US',
  gl: 'US',
  ceid: 'US:en',
})
/** Two sessions: a suggestion cites a catalyst, not an archive. */
const SEARCH_WINDOW = 'when:2d'
const QUOTE_RE = /"/g
const REGEX_SPECIAL_RE = /[.*+?^${}()|[\]\\]/g

export function createGoogleNewsSources(
  options: SourceAdapterOptions
): readonly RegisteredSource[] {
  return [newsSource(options)]
}

function newsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: GOOGLE_NEWS_ID,
    kind: 'news',
    format: 'text',
    http: options.http,
    // A request naming no subject is unsupported rather than answerable: searching the ticker
    // alone returns whatever else those letters spell.
    covers: (context) => context.instrument !== undefined && subjectTerms(context).length > 0,
    request: (context) => ({
      path: SEARCH_PATH,
      query: { q: searchQuery(context), ...SEARCH_LOCALE },
    }),
    parse: (raw, context, fetchedAt) =>
      subjectItems(toFeedItems(raw, GOOGLE_NEWS_ID, fetchedAt), subjectTerms(context)),
  })
}

/** Groups are ANDed and the alternatives inside one are ORed, which is Google News' own reading of
 *  a parenthesized query. */
function searchQuery(context: SourceContext): string {
  const subject = subjectTerms(context)
  const topic = uniqueTerms(context.searchTopic ?? [])
  const groups = topic.length === 0 ? [subject] : [subject, topic]

  return `${groups.map(orGroup).join(' ')} ${SEARCH_WINDOW}`
}

function orGroup(terms: readonly string[]): string {
  return `(${terms.map((term) => `"${term}"`).join(' OR ')})`
}

function subjectTerms(context: SourceContext): readonly string[] {
  return uniqueTerms(context.searchSubject ?? [])
}

/** Quotes group the alternatives, so a term carrying one would split the group. The first spelling
 *  of a term wins, because the caller orders them most specific first. */
function uniqueTerms(terms: readonly string[]): readonly string[] {
  const kept = new Map<string, string>()

  for (const term of terms) {
    const cleaned = term.replace(QUOTE_RE, ' ').trim()

    if (cleaned !== '' && !kept.has(cleaned.toLowerCase())) {
      kept.set(cleaned.toLowerCase(), cleaned)
    }
  }

  return [...kept.values()]
}

/** A search ranks by relevance, not by subject, so most of what comes back for a narrow name is
 *  about the topic instead. A headline that does not say the subject cannot be evidence about it. */
function subjectItems(
  parsed: ParsedSource<readonly NewsItem[]>,
  subject: readonly string[]
): ParsedSource<readonly NewsItem[]> {
  const matchers = subject.map(subjectMatcher)

  return parsedSource(
    parsed.value.filter((item) => matchers.some((matcher) => matcher.test(item.title))),
    parsed.caveats
  )
}

/** An all-caps term is a symbol, and matching one loosely matches ordinary words — `OP` would take
 *  every op-ed. A name is matched however a headline capitalizes it. */
function subjectMatcher(term: string): RegExp {
  const escaped = term.replace(REGEX_SPECIAL_RE, '\\$&')

  return new RegExp(`\\b${escaped}\\b`, term === term.toUpperCase() ? '' : 'i')
}
