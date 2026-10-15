import type {
  EvidenceDeps,
  EvidencePart,
  EvidenceRequest,
  NewsHeadline,
} from '@/trading/features/themes/evidence/deps'
import type { EvidenceDraft } from '@/trading/features/themes/types'
import { THEME_MARKET } from '@/trading/features/themes/types'
import { utcDayOf } from '@/trading/sources/rows/normalization'

/** About a day and a half of VN and macro feeds: enough to see a story, small enough to read. */
export const MAXIMUM_NEWS_ITEMS = 120
const MAXIMUM_SUMMARY_CHARS = 280
const SPACES_RE = /\s+/g

function toOrigin(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    // An unparsable URL is still one publisher; its own text keeps it apart from the rest.
    return url
  }
}

/** One story under one title, however many outlets syndicated it. */
export function toStoryKey(item: Pick<NewsHeadline, 'title'>): string {
  return item.title.toLowerCase().replace(SPACES_RE, ' ').trim()
}

function toDraft(item: NewsHeadline): EvidenceDraft {
  return {
    kind: 'news',
    origin: toOrigin(item.url),
    text:
      item.summary === undefined
        ? item.title
        : `${item.title}. ${item.summary.slice(0, MAXIMUM_SUMMARY_CHARS)}`,
    day: utcDayOf(item.publishedAt),
  }
}

/** Newest first; a story syndicated under one title is one item, the newest copy. Other markets'
 *  headlines stay out; a feed no market owns (the Fed, world business news) stays in. */
function toDrafts(items: readonly NewsHeadline[]): readonly EvidenceDraft[] {
  const stories = new Map<string, NewsHeadline>()

  for (const item of items) {
    const key = toStoryKey(item)
    const relevant = item.market === undefined || item.market === THEME_MARKET

    if (relevant && !stories.has(key)) {
      stories.set(key, item)
    }
  }

  return [...stories.values()].map(toDraft)
}

export async function readNews(
  deps: EvidenceDeps,
  request: EvidenceRequest
): Promise<EvidencePart> {
  const items = await deps.listNews({
    fromMs: request.newsSince,
    toMs: request.now,
    signal: request.signal,
  })

  const stories = toDrafts(items)

  // The oldest stories past the cap are dropped, so re-reading the window would only repeat these.
  return {
    kind: 'news',
    drafts: stories.slice(0, MAXIMUM_NEWS_ITEMS),
    missing: false,
    ...(stories.length > MAXIMUM_NEWS_ITEMS ? { capped: true } : {}),
  }
}
