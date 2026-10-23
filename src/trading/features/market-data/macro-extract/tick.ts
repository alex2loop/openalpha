import type { ProviderChain } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { AttemptRecorder } from '@/engine/api'
import type { MacroSeriesSpec } from '@/trading/features/market-data/macro-extract/catalogue'
import type {
  MacroDocumentKind,
  MacroExtractStore,
} from '@/trading/features/market-data/store/macro-extract'
import type {
  ArchivedNewsItem,
  NewsArchiveStore,
} from '@/trading/features/market-data/store/news-archive'
import type { SourceRegistry } from '@/trading/markets/types'
import { MS_PER_DAY } from '@/core/utils/time'
import { askExtraction } from '@/trading/features/market-data/macro-extract/ask'
import { PRESS_SERIES, REPORT_SERIES } from '@/trading/features/market-data/macro-extract/catalogue'
import { verifyAnswers } from '@/trading/features/market-data/macro-extract/verify'
import { region } from '@/trading/kernel/instrument'
import { recentMonths, toMonth, toMonthEnd, toPreviousMonth } from '@/trading/kernel/market/month'

const BACKFILL_MONTHS = 24
const PRESS_WINDOW_DAYS = 45
/** A release reports the month before it, sometimes two. */
const PRESS_PERIOD_MONTHS = 3
const PUBLIC_INVESTMENT_RE = /giải ngân|đầu tư công/i
const PMI_RE = /\bPMI\b/i
const VIETNAM_RE = /Việt Nam|Vietnam/i
const VN_REGION = region('vn')

interface MacroExtractDeps {
  readonly sources: SourceRegistry
  readonly store: MacroExtractStore
  readonly news: Pick<NewsArchiveStore, 'listPublished'>
  readonly chain: ProviderChain
  readonly recordAttempt: AttemptRecorder
  readonly batchSize: number
  readonly logger: Logger
}

interface TickContext {
  readonly now: number
  readonly signal: AbortSignal
}

interface SourceDocument {
  readonly kind: MacroDocumentKind
  readonly url: string
  readonly text: string
  readonly month?: string
  readonly publishedAt?: number
  readonly series: readonly MacroSeriesSpec[]
  readonly allowedMonths: ReadonlySet<string>
}

async function readDocument(
  deps: MacroExtractDeps,
  document: SourceDocument,
  context: TickContext
): Promise<void> {
  const reply = await askExtraction({
    chain: deps.chain,
    recordAttempt: deps.recordAttempt,
    series: document.series,
    text: document.text,
    signal: context.signal,
  })

  // Recorded as read with nothing accepted, like a reply whose every figure failed verification:
  // otherwise the same document costs a model call every tick and holds a batch slot forever.
  if (reply.answers === undefined) {
    deps.logger.warn('trading.macro_extract_unreadable', { url: document.url, model: reply.model })
  }

  const answers = reply.answers ?? []
  const verified = verifyAnswers({ ...document, answers, sourceText: document.text })
  const written = await deps.store.record({
    document: {
      url: document.url,
      kind: document.kind,
      ...(document.month === undefined ? {} : { month: document.month }),
      ...(document.publishedAt === undefined ? {} : { publishedAt: document.publishedAt }),
      model: reply.model,
      points: verified.accepted.map((answer) => ({ ...answer, day: toMonthEnd(answer.period) })),
    },
    now: context.now,
    signal: context.signal,
  })

  deps.logger.info('trading.macro_extracted', {
    url: document.url,
    written,
    rejected: verified.rejected.map((entry) => `${entry.answer.seriesId}:${entry.reason}`),
    costUsd: reply.costUsd,
  })
}

/** Newest unread months first. A month the office has not posted yet stays unread and costs one
 *  request per tick, never a model call. */
async function readReports(deps: MacroExtractDeps, context: TickContext): Promise<void> {
  const read = await deps.store.listReadMonths(context.signal)
  const latest = toPreviousMonth(toMonth(context.now))
  const months = recentMonths(latest, BACKFILL_MONTHS)
    .filter((month) => !read.has(month))
    .slice(0, deps.batchSize)

  for (const month of months) {
    const day = toMonthEnd(month)
    const result = await deps.sources.resolve({
      kind: 'statReports',
      context: { region: VN_REGION, fromDay: day, toDay: day },
      signal: context.signal,
    })

    // Unreachable rather than unpublished: the rest would time out the same way.
    if (result.kind === 'unavailable' && result.reason === 'failed') {
      return
    }

    const report = result.kind === 'available' ? result.value[0] : undefined

    if (report !== undefined) {
      await readDocument(
        deps,
        {
          kind: 'official',
          url: report.url,
          text: report.text,
          month,
          series: REPORT_SERIES,
          allowedMonths: new Set([month]),
        },
        context
      )
    }
  }
}

/** The press runs other countries' PMIs too; public investment is always the domestic budget. */
function isPressCandidate(item: ArchivedNewsItem): boolean {
  const text = `${item.title} ${item.summary ?? ''}`

  return PUBLIC_INVESTMENT_RE.test(text) || (PMI_RE.test(text) && VIETNAM_RE.test(text))
}

async function readPress(deps: MacroExtractDeps, context: TickContext): Promise<void> {
  const items = await deps.news.listPublished({
    fromMs: context.now - PRESS_WINDOW_DAYS * MS_PER_DAY,
    toMs: context.now,
    signal: context.signal,
  })
  const candidates = items.filter(isPressCandidate)
  const read = await deps.store.listReadUrls(
    candidates.map((item) => item.url),
    context.signal
  )
  const unread = candidates.filter((item) => !read.has(item.url)).slice(0, deps.batchSize)

  for (const item of unread) {
    await readDocument(
      deps,
      {
        kind: 'press',
        url: item.url,
        publishedAt: item.publishedAt,
        text: [item.title, item.summary].filter(Boolean).join('. '),
        series: PRESS_SERIES,
        allowedMonths: new Set(recentMonths(toMonth(item.publishedAt), PRESS_PERIOD_MONTHS)),
      },
      context
    )
  }
}

/** At most `batchSize` office reports and `batchSize` press items a tick, each one model call. */
export function createMacroExtractTick(
  deps: MacroExtractDeps
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const context: TickContext = { now: Date.now(), signal }

    await readReports(deps, context)
    await readPress(deps, context)
  }
}
