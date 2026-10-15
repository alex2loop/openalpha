// Source class: free, official. The statistics office's monthly socio-economic report, read
// through its WordPress API: every report carries one tag, and a report is posted early in the
// month after the one it covers. The site's own listing pages skip some reports; the tag does not.
// Posts dated before September 2024 were stamped late in the covered month itself, so the rule
// holds only from then on.

import { z } from 'zod'

import type { StatReport } from '@/trading/kernel/market/stat-report'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { toMonthEnd, toMonthOf, toNextMonth } from '@/trading/kernel/market/month'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { htmlToText } from '@/trading/sources/rows/html-text'
import { canonicalUrl, parseRow } from '@/trading/sources/rows/normalization'

const NSO_ID = sourceId('nso')
const POSTS_PATH = '/wp-json/wp/v2/posts'
/** `bao-cao-tinh-hinh-kinh-te-xa-hoi-hang-thang`, the tag on every monthly report since 2000. */
const MONTHLY_REPORT_TAG = '727'
const POST_FIELDS = 'link,content'
const MONTH_START_SUFFIX = '-01T00:00:00'
const POSTS = z.array(
  z.object({
    link: z.string().min(1),
    content: z.object({ rendered: z.string().min(1) }),
  })
)

export const NSO_DEFAULT_ENDPOINT = 'https://www.nso.gov.vn'

function toRequestedMonth(context: SourceContext): string | undefined {
  return context.toDay === undefined ? undefined : toMonthOf(context.toDay)
}

function toPostsQuery(month: string): Readonly<Record<string, string>> {
  const published = toNextMonth(month)

  return {
    tags: MONTHLY_REPORT_TAG,
    after: `${published}${MONTH_START_SUFFIX}`,
    before: `${toNextMonth(published)}${MONTH_START_SUFFIX}`,
    _fields: POST_FIELDS,
  }
}

/** Empty until the office posts the month. */
function toStatReports(
  raw: unknown,
  context: SourceContext,
  fetchedAt: number
): readonly StatReport[] {
  const [post] = parseRow(POSTS, raw, 'nso posts')
  const month = toRequestedMonth(context)

  if (post === undefined || month === undefined) {
    return []
  }

  return [
    {
      period: toMonthEnd(month),
      url: canonicalUrl(post.link),
      text: htmlToText(post.content.rendered),
      sourceId: NSO_ID,
      fetchedAt,
    },
  ]
}

export function createNsoSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createSource({
      id: NSO_ID,
      kind: 'statReports',
      format: 'json',
      http: options.http,
      covers: (context) => context.toDay !== undefined,
      request: (context) => {
        const month = toRequestedMonth(context)

        return month === undefined ? null : { path: POSTS_PATH, query: toPostsQuery(month) }
      },
      parse: (raw, context, fetchedAt) => parsedSource(toStatReports(raw, context, fetchedAt)),
    }),
  ]
}
