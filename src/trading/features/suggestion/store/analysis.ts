import { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import type { AnalysisId, AnalysisRecord } from '@/trading/features/suggestion/analysis/types'
import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { AnalysisCase, ClaimVerification } from '@/trading/features/suggestion/debate/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { Page, PageOptions } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { LOCALES } from '@/core/types/locale'
import { definedOnly } from '@/core/utils/collections'
import { analysisId } from '@/trading/features/suggestion/analysis/types'
import { CLAIM_VERDICTS, RESEARCH_STANCES } from '@/trading/features/suggestion/debate/types'
import {
  type CitationPayload,
  citationSchema,
  factorMetricsSchema,
} from '@/trading/features/suggestion/store/suggestion-payload'
import {
  ticker as brandTicker,
  currencyCode,
  marketRef,
  tradingDay,
} from '@/trading/kernel/instrument'
import { caveatsSchema } from '@/trading/kernel/store/store-payload'
import { parseJson, toPage } from '@/trading/kernel/store/store-row'

const COLUMNS = 'id, market, ticker, at, evidence_through, payload, created_at'

const caseSchema = z.strictObject({
  stance: z.enum(RESEARCH_STANCES),
  summary: z.string(),
  claims: z.array(z.string()),
  citations: z.array(citationSchema),
  invalidators: z.array(z.string()),
})

const payloadSchema = z.strictObject({
  authoredLocale: z.enum(LOCALES),
  result: z.strictObject({
    bull: caseSchema,
    bear: caseSchema,
    verification: z.strictObject({
      verified: z.array(
        z.strictObject({
          id: z.string(),
          verdict: z.enum(CLAIM_VERDICTS),
          citation: citationSchema.optional(),
        })
      ),
    }),
    claims: z.array(z.strictObject({ id: z.string(), text: z.string() })),
    playbook: z.array(z.string()),
    models: z.array(z.string()),
  }),
  citations: z.array(citationSchema),
  // Absent on a row stored before the analysis kept what it read.
  headlines: z.array(citationSchema).default([]),
  figures: factorMetricsSchema.default([]),
  boardScale: z
    .strictObject({
      currency: z.string(),
      display: z.strictObject({ divisor: z.number(), decimals: z.number() }),
    })
    .optional(),
  caveats: caveatsSchema,
})

type AnalysisPayload = z.infer<typeof payloadSchema>

interface AnalysisRow {
  readonly id: string
  readonly market: string
  readonly ticker: string
  readonly at: string
  readonly evidence_through: string | null
  readonly payload: string
  readonly created_at: number
}

export interface AnalysisPageOptions extends PageOptions<AnalysisId> {
  /** One name's analyses only. */
  readonly instrument?: InstrumentRef
  readonly signal: AbortSignal
}

interface AnalysisStoreDeps extends StoreDeps {
  readonly logger: Logger
}

/** Analyses are a record of what was read, kept apart from `suggestions`: nothing in one is a
 *  call, so nothing in one is scored, sized or counted by the track record. */
export interface AnalysisStore {
  create(record: AnalysisRecord, signal: AbortSignal): Promise<void>
  /** Newest first. */
  listPage(options: AnalysisPageOptions): Promise<Page<AnalysisRecord, AnalysisId>>
}

export function createAnalysisStore(deps: AnalysisStoreDeps): AnalysisStore {
  return {
    create: (record, signal) => create(deps, record, signal),
    listPage: (options) => listPage(deps, options),
  }
}

async function create(
  deps: AnalysisStoreDeps,
  record: AnalysisRecord,
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  await deps.db.execute(
    `INSERT INTO suggestion_analyses (${COLUMNS}) VALUES (${deps.dialect.paramList(7)})`,
    [
      record.id,
      record.instrument.market,
      record.instrument.ticker,
      record.at,
      record.evidenceThrough ?? null,
      JSON.stringify({
        authoredLocale: record.authoredLocale,
        result: record.result,
        citations: record.citations,
        headlines: record.headlines,
        figures: record.figures,
        boardScale: record.boardScale,
        caveats: record.caveats,
      }),
      record.createdAt,
    ]
  )
}

async function listPage(
  deps: AnalysisStoreDeps,
  options: AnalysisPageOptions
): Promise<Page<AnalysisRecord, AnalysisId>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  const filters: string[] = []

  if (options.instrument !== undefined) {
    params.push(options.instrument.market, options.instrument.ticker)
    filters.push(`market = ${p(params.length - 1)} AND ticker = ${p(params.length)}`)
  }

  if (options.cursor !== undefined) {
    params.push(options.cursor)
    filters.push(`id < ${p(params.length)}`)
  }

  params.push(options.limit + 1)

  const where = filters.length === 0 ? '' : ` WHERE ${filters.join(' AND ')}`
  const rows = await deps.db.query<AnalysisRow>(
    `SELECT ${COLUMNS} FROM suggestion_analyses${where} ORDER BY id DESC LIMIT ${p(params.length)}`,
    params
  )

  // Paged on the rows, not on what they parsed to, so the cursor clears one it could not read.
  const page = toPage(rows, options.limit, (row) => analysisId(row.id))

  return {
    items: page.items.flatMap((row) => readableRow(deps, row)),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  }
}

/** An unreadable row leaves the page rather than failing it. */
function readableRow(deps: AnalysisStoreDeps, row: AnalysisRow): readonly AnalysisRecord[] {
  try {
    return [toRecord(row)]
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      deps.logger.warn('trading.analysis_row_unreadable', { id: row.id, err: formatErrForLog(err) })

      return []
    }

    throw err
  }
}

function toRecord(row: AnalysisRow): AnalysisRecord {
  const payload = parseJson(row.payload, 'analysis', (value) => payloadSchema.parse(value))
  const { result } = payload

  return {
    id: analysisId(row.id),
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    at: tradingDay(row.at),
    authoredLocale: payload.authoredLocale,
    createdAt: row.created_at,
    result: {
      ...result,
      bull: toCase(result.bull),
      bear: toCase(result.bear),
      verification: toVerification(result.verification),
    },
    citations: payload.citations.map(toCitation),
    headlines: payload.headlines.map(toCitation),
    figures: payload.figures.map((raw) => ({
      id: raw.id,
      value: raw.value,
      ...definedOnly({ sessions: raw.sessions }),
    })),
    ...(payload.boardScale === undefined
      ? {}
      : {
          boardScale: {
            currency: currencyCode(payload.boardScale.currency),
            display: payload.boardScale.display,
          },
        }),
    caveats: payload.caveats,
    ...(row.evidence_through === null ? {} : { evidenceThrough: tradingDay(row.evidence_through) }),
  }
}

function toCase(raw: z.infer<typeof caseSchema>): AnalysisCase {
  return { ...raw, citations: raw.citations.map(toCitation) }
}

function toVerification(raw: AnalysisPayload['result']['verification']): ClaimVerification {
  return {
    verified: raw.verified.map((entry) => ({
      id: entry.id,
      verdict: entry.verdict,
      ...(entry.citation === undefined ? {} : { citation: toCitation(entry.citation) }),
    })),
  }
}

function toCitation(raw: CitationPayload): SuggestionCitation {
  return { url: raw.url, ...definedOnly({ title: raw.title, publishedAt: raw.publishedAt }) }
}
