// Source class: free (TOS caveat). Headline, link, date, and publisher name
// only — article bodies are never stored or redistributed. The feed map below is the allowlist: a
// feed outside it is never fetched. Feeds are code-owned because which publisher covers a market
// is a research decision made once, not a per-install preference.

import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { type Caveat, type CaveatCode, sourcedCaveat } from '@/trading/kernel/caveat'
import { sourceId } from '@/trading/kernel/source/source-id'
import { ECONOMY_FEED_SCOPE } from '@/trading/kernel/source/source-result'
import { createSource, parsedSource } from '@/trading/sources/define'
import { toFeedItems } from '@/trading/sources/rows/feed'

/** Feed ids, not one per market: a scope reads every feed listed for it, merged. Publisher
 *  feeds first; the two `gold` entries and the global economy entry stay on aggregators only
 *  because no publisher feed was found for them.
 *
 *  Every URL here is the *resolved* one — the client never follows redirects, so a form that answers
 *  301/308 fetches nothing. CoinDesk drops the trailing slash (`…/rss/` → 308) and a GoldSeek entry,
 *  should one ever be added, needs the apex host (`www.goldseek.com` → 301). */
const MACRO_FEED_KEY = 'macro'

export const RSS_FEEDS: Readonly<Record<string, string>> = Object.freeze({
  crypto: 'https://www.coindesk.com/arc/outboundfeeds/rss',
  gold: 'https://news.google.com/rss/search?q=(gold+price+OR+silver+price+OR+"precious+metals")+when:2d&hl=en-US&gl=US&ceid=US:en',
  'equity-vn': 'https://cafef.vn/thi-truong-chung-khoan.rss',
  'economy-vn': 'https://cafef.vn/vi-mo-dau-tu.rss',
  'politics-vn': 'https://vnexpress.net/rss/thoi-su.rss',
  'gold-vn':
    'https://news.google.com/rss/search?q=(giá+vàng+OR+SJC)+when:1d&hl=vi&gl=VN&ceid=VN:vi',
  [MACRO_FEED_KEY]: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
  'economy-global': 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
})

const SCOPE_FEEDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  crypto: ['crypto', 'economy-global'],
  gold: ['gold'],
  'equity-vn': ['equity-vn', 'economy-vn', 'politics-vn'],
  'gold-vn': ['gold-vn'],
  [MACRO_FEED_KEY]: [MACRO_FEED_KEY],
  [ECONOMY_FEED_SCOPE]: ['economy-global'],
})

const RSS_ID = sourceId('rss')

// One scope per fetch; a scope may read several feeds, merged below.
export function createRssSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [newsSource(options)]
}

function newsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: RSS_ID,
    kind: 'news',
    http: options.http,
    // A feed serves a market or the macro tape, so answering an instrument-scoped request would
    // attribute a whole feed's headlines to one name. A region-only request falls through to
    // `MACRO_FEED_KEY` below, so it must not be covered either — a VN-only ask would otherwise get
    // the Fed's press releases stamped as VN news.
    covers: (context) =>
      context.instrument === undefined &&
      (context.market !== undefined || context.region === undefined),
    load: (context, signal) => loadFeeds(options, feedsFor(context), signal),
  })
}

function feedsFor(context: SourceContext): readonly string[] {
  const scope = context.feedScope ?? context.market ?? MACRO_FEED_KEY

  return SCOPE_FEEDS[scope] ?? [scope]
}

async function loadFeeds(
  options: SourceAdapterOptions,
  feedIds: readonly string[],
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly NewsItem[]>>> {
  const outcomes = await Promise.all(
    feedIds.map((feedId) => options.http.getText({ sourceId: RSS_ID, path: '/', feedId, signal }))
  )
  const items: NewsItem[] = []
  const caveats: Caveat[] = []
  let failed = 0
  let errorCode: CaveatCode | undefined
  let fetchedAt = 0

  for (const [index, feedId] of feedIds.entries()) {
    const outcome = outcomes[index]

    if (outcome === undefined || outcome.kind !== 'ok') {
      failed += 1

      if (outcome !== undefined && outcome.kind === 'error') {
        errorCode ??= outcome.code
      }

      caveats.push(sourcedCaveat('source.unavailable', [feedId], { sourceKind: 'news' }))
      continue
    }

    const parsed = toFeedItems(outcome.value, RSS_ID, outcome.fetchedAt)

    items.push(...parsed.value)
    caveats.push(...parsed.caveats)
    fetchedAt = Math.max(fetchedAt, outcome.fetchedAt)
  }

  if (failed === feedIds.length) {
    return { kind: 'error', code: errorCode ?? 'source.unavailable' }
  }

  return { kind: 'ok', value: parsedSource(items, caveats), fetchedAt }
}
