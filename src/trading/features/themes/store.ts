import { z } from 'zod'

import type { Transaction } from '@/core/types/storage'
import type {
  DueOutcomeOptions,
  PendingOutcome,
  ThemeOutcome,
  ThemeOutcomeResolution,
} from '@/trading/features/themes/outcomes/store'
import type { StoredReadRow } from '@/trading/features/themes/stored-reads'
import type {
  Theme,
  ThemeBundle,
  ThemeId,
  ThemeReadLevel,
  ThemeRun,
  ThemeRunReads,
  ThemeStatus,
  ThemeTransitionOutcome,
} from '@/trading/features/themes/types'
import type { Page } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import {
  insertPendingOutcomes,
  listDueOutcomes,
  listOutcomes,
  resolveOutcome,
} from '@/trading/features/themes/outcomes/store'
import { toReadRows, toRunReads } from '@/trading/features/themes/stored-reads'
import {
  THEME_GAPS,
  THEME_MATURITIES,
  THEME_READ_LEVELS,
  THEME_STATUSES,
  THEME_STEP_FAILURES,
  TRACKED_THEME_STATUSES,
  themeId,
} from '@/trading/features/themes/types'
import { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'
import { parseJson, toBindChunks } from '@/trading/kernel/store/store-row'

const THEME_COLUMNS = [
  'id',
  'title',
  'thesis',
  'status',
  'maturity',
  'invalidation',
  'created_at',
  'updated_at',
] as const
const RUN_COLUMNS = [
  'id',
  'theme_id',
  'started_at',
  'finished_at',
  'prompt_version',
  'score_version',
  'cost_usd',
  'bundle',
  'gaps',
  'notes',
] as const
const READ_COLUMNS = [
  'run_id',
  'theme_id',
  'level',
  'subject',
  'score',
  'confidence',
  'payload',
] as const
const RUN_SELECT =
  'SELECT id, theme_id, started_at, finished_at, prompt_version, score_version, cost_usd, gaps, ' +
  'notes FROM theme_runs'
const THEME_LEVEL: ThemeReadLevel = 'theme'
const THEME_SELECT =
  'SELECT id, title, thesis, status, maturity, invalidation, created_at, approved_at, ' +
  'updated_at FROM themes'
const STATUS = z.enum(THEME_STATUSES)
const MATURITY = z.enum(THEME_MATURITIES)
const TEXTS = z.array(z.string())
const GAPS = z.array(z.enum(THEME_GAPS))
const NOTES = z.array(
  z.object({
    level: z.enum(THEME_READ_LEVELS),
    themeId: z.string().exactOptional(),
    subject: z.string().exactOptional(),
    sector: z.enum(ICB_SUPERSECTORS).exactOptional(),
    cause: z.enum(THEME_STEP_FAILURES),
    env: z.string().exactOptional(),
  })
)

interface ThemeRow {
  readonly id: string
  readonly title: string
  readonly thesis: string
  readonly status: string
  readonly maturity: string
  readonly invalidation: string
  readonly created_at: number
  readonly approved_at: number | null
  readonly updated_at: number
}

interface RunRow {
  readonly id: string
  readonly theme_id: string | null
  readonly started_at: number
  readonly finished_at: number
  readonly prompt_version: string
  readonly score_version: string
  readonly cost_usd: number
  readonly gaps: string
  readonly notes: string
}

interface SnapshotRow extends StoredReadRow {
  readonly run_id: string
}

/** A theme's reads at every level from one run, with that run. */
export interface ThemeSnapshot {
  readonly run: ThemeRun
  readonly reads: ThemeRunReads
}

interface RecordRunOptions {
  readonly run: ThemeRun
  readonly bundle: ThemeBundle
  readonly reads: ThemeRunReads
  readonly proposals: readonly Theme[]
  readonly signal: AbortSignal
}

interface TransitionOptions {
  readonly id: Theme['id']
  readonly from: readonly ThemeStatus[]
  readonly to: ThemeStatus
  readonly now: number
  readonly signal: AbortSignal
}

export interface ThemeStore {
  /** Every theme, oldest first; the list stays short because only the operator adds to it. */
  listThemes(signal: AbortSignal): Promise<readonly Theme[]>
  /** `full` counts only the runs that read every tracked theme; `any` counts focused runs too. */
  findLatestRun(scope: 'any' | 'full', signal: AbortSignal): Promise<ThemeRun | undefined>
  listSnapshots(
    depth: number,
    signal: AbortSignal
  ): Promise<ReadonlyMap<ThemeId, readonly ThemeSnapshot[]>>
  /** One transaction: the run, its reads at every level, their pending outcomes, its proposals and
   *  the tracked themes' new statuses. */
  recordRun(options: RecordRunOptions): Promise<void>
  transition(options: TransitionOptions): Promise<ThemeTransitionOutcome>
  listDueOutcomes(options: DueOutcomeOptions): Promise<Page<PendingOutcome, string>>
  resolveOutcome(
    id: string,
    resolution: ThemeOutcomeResolution,
    signal: AbortSignal
  ): Promise<boolean>
  listOutcomes(signal: AbortSignal): Promise<readonly ThemeOutcome[]>
}

function toTheme(row: ThemeRow): Theme {
  return {
    id: themeId(row.id),
    title: row.title,
    thesis: row.thesis,
    status: STATUS.parse(row.status),
    maturity: MATURITY.parse(row.maturity),
    invalidation: parseJson(row.invalidation, 'theme invalidation', (value) => TEXTS.parse(value)),
    createdAt: Number(row.created_at),
    ...(row.approved_at === null ? {} : { approvedAt: Number(row.approved_at) }),
    updatedAt: Number(row.updated_at),
  }
}

function toRun(row: RunRow): ThemeRun {
  return {
    id: row.id,
    ...(row.theme_id === null ? {} : { themeId: themeId(row.theme_id) }),
    startedAt: Number(row.started_at),
    finishedAt: Number(row.finished_at),
    promptVersion: row.prompt_version,
    scoreVersion: row.score_version,
    costUsd: Number(row.cost_usd),
    gaps: parseJson(row.gaps, 'theme run gaps', (value) => GAPS.parse(value)),
    notes: parseJson(row.notes, 'theme run notes', (value) => NOTES.parse(value)).map(
      ({ themeId: id, ...note }) => (id === undefined ? note : { ...note, themeId: themeId(id) })
    ),
  }
}

async function listThemes(deps: StoreDeps, signal: AbortSignal): Promise<readonly Theme[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<ThemeRow>(`${THEME_SELECT} ORDER BY created_at`)

  return rows.map(toTheme)
}

async function findLatestRun(
  deps: StoreDeps,
  input: { readonly scope: 'any' | 'full'; readonly signal: AbortSignal }
): Promise<ThemeRun | undefined> {
  assertNotAborted(input.signal)

  const where = input.scope === 'full' ? ' WHERE theme_id IS NULL' : ''
  const [row] = await deps.db.query<RunRow>(
    `${RUN_SELECT}${where} ORDER BY started_at DESC, id DESC LIMIT 1`
  )

  return row === undefined ? undefined : toRun(row)
}

/** Each theme's last `depth` runs that read it, newest first, with that theme's reads from each. */
async function listSnapshots(
  deps: StoreDeps,
  input: { readonly depth: number; readonly signal: AbortSignal }
): Promise<ReadonlyMap<ThemeId, readonly ThemeSnapshot[]>> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<SnapshotRow>(
    'SELECT reads.run_id, reads.theme_id, reads.level, reads.subject, reads.score, ' +
      'reads.confidence, reads.payload FROM theme_reads reads JOIN (' +
      'SELECT head.run_id, head.theme_id, ROW_NUMBER() OVER (PARTITION BY head.theme_id ' +
      'ORDER BY runs.started_at DESC, runs.id DESC) AS recency ' +
      'FROM theme_reads head JOIN theme_runs runs ON runs.id = head.run_id ' +
      `WHERE head.level = ${p(1)}) ranked ` +
      'ON ranked.run_id = reads.run_id AND ranked.theme_id = reads.theme_id ' +
      `WHERE ranked.recency <= ${p(2)} ` +
      'ORDER BY reads.theme_id, ranked.recency, reads.level, reads.subject',
    [THEME_LEVEL, input.depth]
  )
  const runs = await listRunsById(deps, [...new Set(rows.map((row) => row.run_id))])

  return new Map(
    [...Map.groupBy(rows, (row) => row.theme_id)].map(([id, themeRows]) => [
      themeId(id),
      toSnapshots(themeRows, runs),
    ])
  )
}

async function listRunsById(
  deps: StoreDeps,
  ids: readonly string[]
): Promise<ReadonlyMap<string, ThemeRun>> {
  if (ids.length === 0) {
    return new Map()
  }

  const rows = await deps.db.query<RunRow>(
    `${RUN_SELECT} WHERE id IN (${deps.dialect.paramList(ids.length, 1)})`,
    ids
  )

  return new Map(rows.map((row) => [row.id, toRun(row)]))
}

/** Rows arrive newest run first, so the groups keep that order. */
function toSnapshots(
  rows: readonly SnapshotRow[],
  runs: ReadonlyMap<string, ThemeRun>
): readonly ThemeSnapshot[] {
  return [...Map.groupBy(rows, (row) => row.run_id)].flatMap(([runId, runRows]) => {
    const run = runs.get(runId)

    return run === undefined ? [] : [{ run, reads: toRunReads(runRows) }]
  })
}

function toThemeValues(theme: Theme): readonly unknown[] {
  return [
    theme.id,
    theme.title,
    theme.thesis,
    theme.status,
    theme.maturity,
    JSON.stringify(theme.invalidation),
    theme.createdAt,
    theme.updatedAt,
  ]
}

async function recordRun(deps: StoreDeps, options: RecordRunOptions): Promise<void> {
  assertNotAborted(options.signal)

  const { run } = options

  await deps.db.transaction(async (tx) => {
    await tx.execute(deps.dialect.insert('theme_runs', { cols: RUN_COLUMNS, rowCount: 1 }), [
      run.id,
      run.themeId ?? null,
      run.startedAt,
      run.finishedAt,
      run.promptVersion,
      run.scoreVersion,
      run.costUsd,
      JSON.stringify(options.bundle),
      JSON.stringify(run.gaps),
      JSON.stringify(run.notes),
    ])

    for (const chunk of toBindChunks(options.proposals, THEME_COLUMNS.length)) {
      const insert = deps.dialect.insert('themes', { cols: THEME_COLUMNS, rowCount: chunk.length })

      await tx.execute(`${insert} ON CONFLICT (id) DO NOTHING`, chunk.flatMap(toThemeValues))
    }

    for (const chunk of toBindChunks(toReadRows(options.reads), READ_COLUMNS.length)) {
      const insert = deps.dialect.insert('theme_reads', {
        cols: READ_COLUMNS,
        rowCount: chunk.length,
      })

      await tx.execute(
        insert,
        chunk.flatMap((row) => [
          run.id,
          row.themeId,
          row.level,
          row.subject,
          row.score,
          row.confidence,
          row.payload,
        ])
      )
    }

    await insertPendingOutcomes(tx, deps, { runId: run.id, stocks: options.reads.stocks })
    await updateTracked(tx, deps, options)
  })
}

/** Only rows still tracked: a theme the operator retired while the run was reading stays retired. */
async function updateTracked(
  tx: Transaction,
  deps: StoreDeps,
  options: RecordRunOptions
): Promise<void> {
  const p = deps.dialect.param
  const proposed = new Set(options.proposals.map((theme) => theme.id))
  const tracked = deps.dialect.paramList(TRACKED_THEME_STATUSES.length, 5)

  for (const read of options.reads.themes.filter((entry) => !proposed.has(entry.themeId))) {
    await tx.execute(
      `UPDATE themes SET status = ${p(1)}, maturity = ${p(2)}, updated_at = ${p(3)} ` +
        `WHERE id = ${p(4)} AND status IN (${tracked})`,
      [read.status, read.maturity, options.run.finishedAt, read.themeId, ...TRACKED_THEME_STATUSES]
    )
  }
}

async function transition(
  deps: StoreDeps,
  options: TransitionOptions
): Promise<ThemeTransitionOutcome> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const approvedAt = options.to === 'active' ? options.now : null
  const result = await deps.db.execute(
    `UPDATE themes SET status = ${p(1)}, updated_at = ${p(2)}, ` +
      `approved_at = COALESCE(${p(3)}, approved_at) WHERE id = ${p(4)} ` +
      `AND status IN (${deps.dialect.paramList(options.from.length, 5)})`,
    [options.to, options.now, approvedAt, options.id, ...options.from]
  )

  if (result.changes > 0) {
    return { kind: 'done' }
  }

  const [row] = await deps.db.query<Pick<ThemeRow, 'status'>>(
    `SELECT status FROM themes WHERE id = ${p(1)}`,
    [options.id]
  )

  return row === undefined
    ? { kind: 'not-found' }
    : { kind: 'not-allowed', status: STATUS.parse(row.status) }
}

export function createThemeStore(deps: StoreDeps): ThemeStore {
  return {
    listThemes: (signal) => listThemes(deps, signal),
    findLatestRun: (scope, signal) => findLatestRun(deps, { scope, signal }),
    listSnapshots: (depth, signal) => listSnapshots(deps, { depth, signal }),
    recordRun: (options) => recordRun(deps, options),
    transition: (options) => transition(deps, options),
    listDueOutcomes: (options) => listDueOutcomes(deps, options),
    resolveOutcome: (id, resolution, signal) => resolveOutcome(deps, { id, resolution, signal }),
    listOutcomes: (signal) => listOutcomes(deps, signal),
  }
}
