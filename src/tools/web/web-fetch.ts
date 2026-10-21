import { z } from 'zod'

import type { CallApprovalContext } from '@/core/tool'
import { createTool } from '@/core/tool'
import { MS_PER_SECOND } from '@/core/utils/time'

const WEB_TIMEOUT_DEFAULT_SECS = 30
const WEB_TIMEOUT_MAX_SECS = 300
// Backstop above the largest transport timeout the model may request: fires only when
// fetchGeneral fails to honor its own cap.
const WEB_FETCH_BACKSTOP_MARGIN_SECS = 30
// The operator writes `vnexpress.net/abc`; the model fetches `https://vnexpress.net/abc/`.
const SCHEME_RE = /^https?:\/\//
const TRAILING_SLASH_RE = /\/$/

const fetchInputSchema = z.object({
  url: z.url().describe('Absolute https:// URL of the page or file to read.'),
  method: z
    .enum(['GET', 'HEAD'])
    .default('GET')
    .describe('GET reads the body; HEAD returns headers only.'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Extra request headers. Omit unless the page needs one.'),
  timeout_secs: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEB_TIMEOUT_MAX_SECS)
    .default(WEB_TIMEOUT_DEFAULT_SECS)
    .describe(`Seconds to wait, 1 to ${WEB_TIMEOUT_MAX_SECS}.`),
  extract_mode: z
    .enum(['raw', 'markdown', 'text'])
    .default('raw')
    .describe(
      'raw keeps the HTML, markdown converts it, text strips every tag. Use markdown to read an article.'
    ),
})

// A URL the operator wrote or a network tool returned is reading. One the model put together, or a
// header it chose, can carry what it read elsewhere in the run out to someone else, so the operator
// is asked first. Past the run's quota every fetch asks, which bounds a page that walks the model
// from link to link.
function canFetchUnasked(input: unknown, context: CallApprovalContext): boolean {
  const parsed = fetchInputSchema.safeParse(input)

  if (!parsed.success) {
    return false
  }

  return (
    parsed.data.headers === undefined &&
    context.callCount <= context.config.loop.maxUnaskedFetches &&
    urlSpellings(parsed.data.url).some((spelling) => context.hasSeen(spelling))
  )
}

function urlSpellings(url: string): readonly string[] {
  return [url, url.replace(SCHEME_RE, '').replace(TRAILING_SLASH_RE, '')]
}

export const webFetchTool = createTool({
  name: 'web_fetch',
  description:
    'Fetch an HTTPS resource with GET or HEAD and a bounded response size. GET reads text only and can extract raw text, Markdown, or plain text. Fetch a URL exactly as the operator or a search result gave it: one you build or change, or extra headers, waits for the operator to approve.',
  inputSchema: fetchInputSchema,
  capability: 'net',
  requiresApproval: (input, context) => !canFetchUnasked(input, context),
  oneTimeApproval: true,
  timeoutMs: (WEB_TIMEOUT_MAX_SECS + WEB_FETCH_BACKSTOP_MARGIN_SECS) * MS_PER_SECOND,
  presentation: { label: 'Fetch page', emoji: '🌐', detailKeys: ['url', 'headers'] },
  async execute(args, ctx): Promise<string> {
    const agent = ctx.services.agents.get(ctx.agentId)

    ctx.reportProgress?.({
      key: 'progress.webConnecting',
      params: { url: args.url },
      mode: 'transient',
    })
    const result = await ctx.services.webRetrieval.fetchGeneral({
      url: args.url,
      method: args.method,
      extractMode: args.extract_mode,
      timeoutMs: args.timeout_secs * MS_PER_SECOND,
      signal: ctx.signal,
      ...(args.headers === undefined ? {} : { headers: args.headers }),
      ...(agent?.hosts === undefined ? {} : { allowedHosts: agent.hosts }),
    })

    ctx.reportProgress?.({ key: 'progress.webReceived', mode: 'transient' })
    ctx.reportProgress?.({
      key: 'progress.webExtracting',
      params: { mode: args.extract_mode },
      mode: 'transient',
    })

    return JSON.stringify({
      url: result.url,
      status: result.status,
      content_type: result.contentType,
      accessed_at: result.retrievedAt,
      body: result.body,
      ...(result.truncated === true ? { truncated: true } : {}),
      ...(result.guidance === undefined ? {} : { guidance: result.guidance }),
    })
  },
})
