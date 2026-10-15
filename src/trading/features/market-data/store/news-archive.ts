import { createHash } from 'node:crypto'

import type { MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { marketRef } from '@/trading/kernel/instrument'
import { toBindChunks } from '@/trading/kernel/store/store-row'

const NEWS_COLUMNS = [
  'id',
  'url',
  'title',
  'summary',
  'published_at',
  'source_id',
  'market',
  'ticker',
  'fetched_at',
] as const
const NEWS_ID_HEX_LENGTH = 32
const NEWS_RETENTION_DAYS = 365

interface NewsRow {
  readonly url: string
  readonly title: string
  readonly summary: string | null
  readonly published_at: number
  readonly market: string | null
}

interface ListNewsOptions {
  readonly fromMs: number
  readonly toMs: number
  readonly signal: AbortSignal
}

export interface ArchivedNewsItem {
  readonly url: string
  readonly title: string
  readonly summary?: string
  readonly publishedAt: number
  readonly market?: MarketRef
}

interface ArchiveNewsOptions {
  readonly items: readonly NewsItem[]
  readonly market?: MarketRef
  readonly ticker?: Ticker
  readonly now: number
  readonly signal: AbortSignal
}

interface DeleteNewsOptions {
  readonly fetchedBefore: number
  readonly limit: number
  readonly signal: AbortSignal
}

/** Code-owned: the rows cannot be fetched again, so a short window set by mistake would delete
 *  history silently. */
export const NEWS_RETENTION_MS = NEWS_RETENTION_DAYS * MS_PER_DAY

export interface NewsArchiveStore {
  /** Idempotent per canonical URL; returns how many rows were new. */
  archive(options: ArchiveNewsOptions): Promise<number>
  deleteFetchedBefore(options: DeleteNewsOptions): Promise<number>
  /** Newest first, by publication time, `fromMs` inclusive and `toMs` exclusive. */
  listPublished(options: ListNewsOptions): Promise<readonly ArchivedNewsItem[]>
}

function toNewsId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, NEWS_ID_HEX_LENGTH)
}

function toNewsValues(options: ArchiveNewsOptions, item: NewsItem): readonly unknown[] {
  return [
    toNewsId(item.url),
    item.url,
    item.title,
    item.summary ?? null,
    item.publishedAt,
    item.sourceIds[0] ?? null,
    options.market ?? null,
    options.ticker ?? null,
    options.now,
  ]
}

async function archive(deps: StoreDeps, options: ArchiveNewsOptions): Promise<number> {
  assertNotAborted(options.signal)

  const sourced = options.items.filter((item) => item.sourceIds.length > 0)
  let inserted = 0

  for (const chunk of toBindChunks(sourced, NEWS_COLUMNS.length)) {
    const insert = deps.dialect.insert('news_items', { cols: NEWS_COLUMNS, rowCount: chunk.length })
    const result = await deps.db.execute(
      `${insert} ON CONFLICT (id) DO NOTHING`,
      chunk.flatMap((item) => toNewsValues(options, item))
    )

    inserted += result.changes
  }

  return inserted
}

async function deleteFetchedBefore(deps: StoreDeps, options: DeleteNewsOptions): Promise<number> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    'DELETE FROM news_items WHERE id IN (' +
      `SELECT id FROM news_items WHERE fetched_at < ${p(1)} LIMIT ${p(2)})`,
    [options.fetchedBefore, options.limit]
  )

  return result.changes
}

async function listPublished(
  deps: StoreDeps,
  options: ListNewsOptions
): Promise<readonly ArchivedNewsItem[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<NewsRow>(
    'SELECT url, title, summary, published_at, market FROM news_items ' +
      `WHERE published_at >= ${p(1)} AND published_at < ${p(2)} ORDER BY published_at DESC`,
    [options.fromMs, options.toMs]
  )

  return rows.map((row) => ({
    url: row.url,
    title: row.title,
    ...(row.summary === null ? {} : { summary: row.summary }),
    publishedAt: Number(row.published_at),
    ...(row.market === null ? {} : { market: marketRef(row.market) }),
  }))
}

export function createNewsArchiveStore(deps: StoreDeps): NewsArchiveStore {
  return {
    archive: (options) => archive(deps, options),
    deleteFetchedBefore: (options) => deleteFetchedBefore(deps, options),
    listPublished: (options) => listPublished(deps, options),
  }
}
