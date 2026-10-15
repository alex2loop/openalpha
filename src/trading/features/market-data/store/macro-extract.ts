import type { Transaction } from '@/core/types/storage'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { toBindChunks } from '@/trading/kernel/store/store-row'

const MACRO_DOCUMENT_KINDS = Object.freeze(['official', 'press'] as const)
const URL_COLUMN_COUNT = 1

export type MacroDocumentKind = (typeof MACRO_DOCUMENT_KINDS)[number]

const OFFICIAL_KIND: MacroDocumentKind = 'official'
const PRESS_KIND: MacroDocumentKind = 'press'

interface ExtractedPoint {
  readonly seriesId: string
  readonly day: TradingDay
  readonly value: number
  readonly quote: string
}

interface ReadDocument {
  readonly url: string
  readonly kind: MacroDocumentKind
  readonly month?: string
  readonly publishedAt?: number
  readonly model: string
  readonly points: readonly ExtractedPoint[]
}

interface RecordDocumentOptions {
  readonly document: ReadDocument
  readonly now: number
  readonly signal: AbortSignal
}

interface PointWrite {
  readonly document: ReadDocument
  readonly point: ExtractedPoint
  readonly now: number
}

export interface MacroExtractStore {
  /** Months whose office report has been read. */
  listReadMonths(signal: AbortSignal): Promise<ReadonlySet<string>>
  listReadUrls(urls: readonly string[], signal: AbortSignal): Promise<ReadonlySet<string>>
  /** The document and every figure it yielded in one transaction, so a stored number always has its
   *  sentence and a read document is never billed again. A press figure never replaces one from the
   *  office. Returns how many figures were written; zero when the document was already read. */
  record(options: RecordDocumentOptions): Promise<number>
}

async function writePoint(tx: Transaction, deps: StoreDeps, write: PointWrite): Promise<boolean> {
  const p = deps.dialect.param
  const { document, point, now } = write
  // A press figure replaces only an older press figure: never the office's, and never a newer item
  // read later because the feed was drained newest first.
  const guard =
    document.kind === PRESS_KIND
      ? `WHERE series_provenance.kind = ${p(9)} AND series_provenance.published_at <= excluded.published_at`
      : ''
  const provenance = await tx.execute(
    'INSERT INTO series_provenance ' +
      '(series_id, day, kind, source_url, quote, model, extracted_at, published_at) ' +
      `VALUES (${deps.dialect.paramList(8)}) ON CONFLICT (series_id, day) DO UPDATE SET ` +
      'kind = excluded.kind, source_url = excluded.source_url, quote = excluded.quote, ' +
      'model = excluded.model, extracted_at = excluded.extracted_at, ' +
      `published_at = excluded.published_at ${guard}`,
    [
      point.seriesId,
      point.day,
      document.kind,
      document.url,
      point.quote,
      document.model,
      now,
      document.publishedAt ?? null,
      ...(document.kind === PRESS_KIND ? [PRESS_KIND] : []),
    ]
  )

  if (provenance.changes === 0) {
    return false
  }

  await tx.execute(
    `INSERT INTO series_points (series_id, day, value, fetched_at) VALUES (${deps.dialect.paramList(4)}) ` +
      'ON CONFLICT (series_id, day) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
    [point.seriesId, point.day, point.value, now]
  )

  return true
}

async function record(deps: StoreDeps, options: RecordDocumentOptions): Promise<number> {
  assertNotAborted(options.signal)

  const { document, now } = options

  return deps.db.transaction(async (tx) => {
    const claimed = await tx.execute(
      'INSERT INTO macro_documents (url, kind, month, model, accepted, extracted_at) ' +
        `VALUES (${deps.dialect.paramList(6)}) ON CONFLICT (url) DO NOTHING`,
      [
        document.url,
        document.kind,
        document.month ?? null,
        document.model,
        document.points.length,
        now,
      ]
    )

    if (claimed.changes === 0) {
      return 0
    }

    let written = 0

    for (const point of document.points) {
      written += (await writePoint(tx, deps, { document, point, now })) ? 1 : 0
    }

    return written
  })
}

async function listReadMonths(deps: StoreDeps, signal: AbortSignal): Promise<ReadonlySet<string>> {
  assertNotAborted(signal)

  const rows = await deps.db.query<{ readonly month: string }>(
    `SELECT month FROM macro_documents WHERE kind = ${deps.dialect.param(1)} AND month IS NOT NULL`,
    [OFFICIAL_KIND]
  )

  return new Set(rows.map((row) => row.month))
}

async function listReadUrls(
  deps: StoreDeps,
  urls: readonly string[],
  signal: AbortSignal
): Promise<ReadonlySet<string>> {
  assertNotAborted(signal)

  const read = new Set<string>()

  for (const chunk of toBindChunks(urls, URL_COLUMN_COUNT)) {
    const rows = await deps.db.query<{ readonly url: string }>(
      `SELECT url FROM macro_documents WHERE url IN (${deps.dialect.paramList(chunk.length)})`,
      [...chunk]
    )

    for (const row of rows) {
      read.add(row.url)
    }
  }

  return read
}

export function createMacroExtractStore(deps: StoreDeps): MacroExtractStore {
  return {
    listReadMonths: (signal) => listReadMonths(deps, signal),
    listReadUrls: (urls, signal) => listReadUrls(deps, urls, signal),
    record: (options) => record(deps, options),
  }
}
