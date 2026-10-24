import { createHash } from 'node:crypto'

import type { InstrumentRef, MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { marketRef, ticker } from '@/trading/kernel/instrument'
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

/** The column a window is read on: a fixed name, never caller text, so it is safe in the SQL. */
type NewsTime = 'published_at' | 'fetched_at'

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

interface InstrumentNewsRow {
  readonly url: string
  readonly title: string
  readonly source_id: string
  readonly published_at: number
  readonly market: string | null
  readonly ticker: string | null
}

interface ListInstrumentNewsOptions {
  readonly instruments: readonly InstrumentRef[]
  /** Inclusive: the stories archived from this instant on. */
  readonly sinceMs: number
  readonly limit: number
  readonly signal: AbortSignal
}

/** A story archived for one instrument: by a read that named that name, never by a feed no market
 *  owns. */
export interface InstrumentHeadline {
  readonly instrument: InstrumentRef
  readonly url: string
  readonly title: string
  readonly sourceId: string
  readonly publishedAt: number
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
  /** Newest published first, of the stories archived from `fromMs` (inclusive) to `toMs`
   *  (exclusive): a story archived late still falls after the reader's last pass. */
  listArchived(options: ListNewsOptions): Promise<readonly ArchivedNewsItem[]>
  /** Newest published first, of the stories archived since `sinceMs` for these instruments, matched
   *  on market and ticker. */
  listForInstruments(options: ListInstrumentNewsOptions): Promise<readonly InstrumentHeadline[]>
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

async function listNews(
  deps: StoreDeps,
  options: ListNewsOptions & { readonly by: NewsTime }
): Promise<readonly ArchivedNewsItem[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<NewsRow>(
    'SELECT url, title, summary, published_at, market FROM news_items ' +
      `WHERE ${options.by} >= ${p(1)} AND ${options.by} < ${p(2)} ORDER BY published_at DESC`,
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

async function listForInstruments(
  deps: StoreDeps,
  options: ListInstrumentNewsOptions
): Promise<readonly InstrumentHeadline[]> {
  assertNotAborted(options.signal)

  if (options.instruments.length === 0) {
    return []
  }

  // Placeholders are numbered in the order they appear, so a positional dialect binds them right.
  const p = deps.dialect.param
  const matches = options.instruments
    .map((_, index) => `(market = ${p(2 + index * 2)} AND ticker = ${p(3 + index * 2)})`)
    .join(' OR ')
  const rows = await deps.db.query<InstrumentNewsRow>(
    'SELECT url, title, source_id, published_at, market, ticker FROM news_items ' +
      `WHERE fetched_at >= ${p(1)} AND (${matches}) ` +
      `ORDER BY published_at DESC, id DESC LIMIT ${p(2 + options.instruments.length * 2)}`,
    [
      options.sinceMs,
      ...options.instruments.flatMap((instrument) => [instrument.market, instrument.ticker]),
      options.limit,
    ]
  )

  return rows.flatMap((row) =>
    row.market === null || row.ticker === null
      ? []
      : [
          {
            instrument: { market: marketRef(row.market), ticker: ticker(row.ticker) },
            url: row.url,
            title: row.title,
            sourceId: row.source_id,
            publishedAt: row.published_at,
          },
        ]
  )
}

export function createNewsArchiveStore(deps: StoreDeps): NewsArchiveStore {
  return {
    archive: (options) => archive(deps, options),
    deleteFetchedBefore: (options) => deleteFetchedBefore(deps, options),
    listPublished: (options) => listNews(deps, { ...options, by: 'published_at' }),
    listArchived: (options) => listNews(deps, { ...options, by: 'fetched_at' }),
    listForInstruments: (options) => listForInstruments(deps, options),
  }
}
