import type { NewsItem } from '@/trading/kernel/market/market-data'
import { MS_PER_DAY, MS_PER_HOUR } from '@/core/utils/time'

const HEADLINE_FRESH_MS = 4 * MS_PER_DAY
/** How long a story's corroboration keeps half its weight. Twelve hours puts an overnight story
 *  behind a fresh one carried by the same number of outlets, without discarding it - the freshness
 *  window still decides what is in scope at all. */
const HEADLINE_HALF_LIFE_MS = 12 * MS_PER_HOUR
const TRAILING_SOURCE = /\s+[-\u2013\u2014|]\s+[^-\u2013\u2014|]+$/u
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu
const WHITESPACE = /\s+/g
/** Ranked per section before rendering, wider than rendered so the cross-section dedupe still has
 *  rows left to pick from. Which publishers those rows come from is the quota's job, not the
 *  window's. */
export const NEWS_ITEMS_PER_SECTION = 12
/** Rendered per section. A digest names what happened in a market; it does not inventory it. */
export const HEADLINES_PER_SECTION = 2
/** An approximation of the public suffix list, not the whole of it. Google News feeds carry
 *  publishers from anywhere, so it reaches past the markets the project trades. */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.in',
  'co.za',
  'co.il',
  'com.vn',
  'com.au',
  'com.br',
  'com.cn',
  'com.hk',
  'com.sg',
  'com.tw',
  'com.tr',
  'com.mx',
  'com.ar',
  'org.uk',
  'net.au',
  'or.jp',
  'ne.jp',
])

/** Registrable domain, not hostname: `vnexpress.net` and `amp.vnexpress.net` are one outlet. The
 *  last two labels answer that for a single-label suffix; under a two-label one they name the
 *  suffix itself, merging unrelated outlets and printing `co.uk` where the publisher belongs. */
export function registrableDomain(url: string): string | undefined {
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.')
    const depth = MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2

    return labels.length < depth ? undefined : labels.slice(-depth).join('.')
  } catch {
    // A headline whose url will not parse cannot be attributed, so it corroborates nothing.
    return undefined
  }
}

/** The outlet a headline is credited to: the publisher behind an aggregator link when the feed
 *  names one, otherwise the host of the link itself. */
export function publisherOf(item: NewsItem): string | undefined {
  return registrableDomain(item.publisherUrl ?? item.url)
}

interface HeadlineRankOptions {
  readonly now: number
  readonly limit: number
}

interface StoryGroup {
  readonly item: NewsItem
  readonly domains: ReadonlySet<string>
}

/** One story, however many outlets carried it. A title that normalizes to nothing is dropped: it
 *  can neither be grouped nor attributed. */
export function groupStories(items: readonly NewsItem[]): readonly StoryGroup[] {
  const groups = new Map<string, { item: NewsItem; domains: Set<string> }>()

  for (const item of items) {
    const key = normalizeTitle(item.title)

    if (key === '') {
      continue
    }

    const domain = publisherOf(item)
    const group = groups.get(key)

    if (group === undefined) {
      groups.set(key, { item, domains: new Set(domain === undefined ? [] : [domain]) })

      continue
    }

    if (domain !== undefined) {
      group.domains.add(domain)
    }

    if (item.publishedAt > group.item.publishedAt) {
      group.item = item
    }
  }

  return [...groups.values()]
}

/** The freshness window is applied before grouping, so a stale mirror can neither carry a group nor
 *  age one. */
export function rankHeadlines(
  items: readonly NewsItem[],
  options: HeadlineRankOptions
): readonly NewsItem[] {
  const fresh = items.filter((item) => {
    const age = options.now - item.publishedAt

    return age >= 0 && age <= HEADLINE_FRESH_MS
  })
  const ranked = groupStories(fresh)
    .map((group) => ({ group, weight: corroborationWeight(group, options.now) }))
    .sort(
      (left, right) =>
        right.weight - left.weight || right.group.item.publishedAt - left.group.item.publishedAt
    )
    .map((entry) => entry.group.item)

  return withPublisherQuota(ranked, options.limit)
}

/** The age clamp matters: a publisher clock running ahead would otherwise produce a negative age
 *  and an exponent that inflates the weight instead of decaying it. */
function corroborationWeight(group: StoryGroup, now: number): number {
  const ageMs = Math.max(now - group.item.publishedAt, 0)

  return group.domains.size * 0.5 ** (ageMs / HEADLINE_HALF_LIFE_MS)
}

/** An even share of the slots per publisher, because rank alone lets the busiest one take them all:
 *  a scope whose world desks file ten times as often as its market desk reports the world. Deferred
 *  stories still fill whatever the cap leaves empty, so a single-publisher scope is untouched.
 *  Applied again at the render limit, where a wider ranking window can still hand one publisher
 *  every row a section shows. */
export function withPublisherQuota(items: readonly NewsItem[], limit: number): readonly NewsItem[] {
  const attributed = items.map((item) => ({ item, publisher: publisherOf(item) }))
  const publishers = new Set(attributed.map((entry) => entry.publisher))
  const cap = Math.ceil(limit / Math.max(publishers.size, 1))
  const taken = new Map<string | undefined, number>()
  const picked: NewsItem[] = []
  const deferred: NewsItem[] = []

  for (const { item, publisher } of attributed) {
    if (picked.length >= limit) {
      break
    }

    const count = taken.get(publisher) ?? 0

    if (count >= cap) {
      deferred.push(item)

      continue
    }

    taken.set(publisher, count + 1)
    picked.push(item)
  }

  return [...picked, ...deferred].slice(0, limit)
}

/** The publisher an aggregator echoes into the title (`… - Reuters`). Empty after stripping means
 *  the title was only the echo, which is not an improvement on the original. */
export function stripTrailingSource(title: string): string {
  const stripped = title.replace(TRAILING_SOURCE, '').trim()

  return stripped === '' ? title : stripped
}

/** The raw strip, not `stripTrailingSource`: a title that is only the echo must key to `''` so the
 *  ranker drops it, where a displayed one falls back to the original rather than rendering empty. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(TRAILING_SOURCE, '')
    .replace(PUNCTUATION, '')
    .replace(WHITESPACE, ' ')
    .trim()
}
