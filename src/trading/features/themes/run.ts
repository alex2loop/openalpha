import { randomUUID } from 'node:crypto'

import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type {
  AnalystDeps,
  AnalystResult,
  AnalystSession,
} from '@/trading/features/themes/analyst/ask'
import type { Proposal } from '@/trading/features/themes/analyst/checks'
import type { ChainDeps } from '@/trading/features/themes/chain/deps'
import type { ChainResults, ChainTheme } from '@/trading/features/themes/chain/stage'
import type { EvidenceDeps } from '@/trading/features/themes/evidence/deps'
import type { ThemeSnapshot, ThemeStore } from '@/trading/features/themes/store'
import type {
  Theme,
  ThemeBundle,
  ThemeId,
  ThemeLookupFailure,
  ThemeRead,
  ThemeReport,
  ThemeRun,
  ThemeRunNote,
  ThemeRunReads,
  ThemeRunRequest,
} from '@/trading/features/themes/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import { assertNotAborted } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { createDelegationQuota } from '@/engine/api'
import { THEME_PROMPT_VERSION } from '@/trading/features/themes/analyst/prompts'
import { discoverThemes, updateTheme } from '@/trading/features/themes/analyst/steps'
import { runChain } from '@/trading/features/themes/chain/stage'
import { buildEvidenceBundle } from '@/trading/features/themes/evidence/bundle'
import { buildScorecard } from '@/trading/features/themes/outcomes/scorecard'
import { SCORE_VERSION } from '@/trading/features/themes/score/compose'
import { toScoredReads } from '@/trading/features/themes/score/reads'
import {
  CLOSED_THEME_STATUSES,
  isDiscoveryNote,
  TRACKED_THEME_STATUSES,
} from '@/trading/features/themes/types'

/** Research workers one run may start across every theme: about one medium pass or a few light. */
const RESEARCH_DELEGATIONS = 12
/** A first run, or one after a long gap, reads this much news and no more. */
const NEWS_WINDOW_DAYS = 30
/** A run needs each theme's latest read, for its previous probability. */
const RUN_SNAPSHOT_DEPTH = 1
/** The report needs the read before it too, for each score's change. */
const REPORT_SNAPSHOT_DEPTH = 2

export interface ThemeRunDeps {
  readonly store: ThemeStore
  readonly evidence: EvidenceDeps
  readonly analyst: AnalystDeps
  /** The stores and calendar the sector and company steps read. */
  readonly chain: ChainDeps
  /** The run's cap: the lower of `[trading.themes] max_cost_usd` and the `[budget]` caps. */
  createRunBudget(): Budget
  /** The VN session `now` falls in, which outcomes fall due against. */
  today(now: number): TradingDay
  readonly logger: Logger
}

type RunScope = { readonly kind: 'scope'; readonly themes: readonly Theme[] } | ThemeLookupFailure

interface ContextInput {
  readonly request: ThemeRunRequest
  readonly themes: readonly Theme[]
  readonly scope: readonly Theme[]
}

interface RunContext extends ContextInput {
  readonly startedAt: number
  readonly previousReads: ReadonlyMap<ThemeId, ThemeRead>
  readonly bundle: ThemeBundle
}

interface ThemeUpdate {
  readonly themeId: ThemeId
  readonly result: AnalystResult<ThemeRead>
}

interface RunResults {
  readonly reads: readonly ThemeRead[]
  readonly proposals: readonly Proposal[]
  readonly notes: readonly ThemeRunNote[]
}

interface FinishedRun {
  readonly context: RunContext
  readonly budget: Budget
  readonly results: RunResults
  readonly chain: ChainResults
}

/** Every tracked theme on a full run; on a focused run the one asked for, once the operator tracks
 *  it. */
function resolveScope(themes: readonly Theme[], focus: ThemeId | undefined): RunScope {
  if (focus === undefined) {
    return { kind: 'scope', themes: themes.filter(isTracked) }
  }

  const theme = themes.find((entry) => entry.id === focus)

  if (theme === undefined) {
    return { kind: 'not-found' }
  }

  return isTracked(theme)
    ? { kind: 'scope', themes: [theme] }
    : { kind: 'not-allowed', status: theme.status }
}

function isTracked(theme: Theme): boolean {
  return TRACKED_THEME_STATUSES.includes(theme.status)
}

async function readContext(deps: ThemeRunDeps, input: ContextInput): Promise<RunContext> {
  const startedAt = Date.now()
  const { request } = input
  const [snapshots, lastFull] = await Promise.all([
    deps.store.listSnapshots(RUN_SNAPSHOT_DEPTH, request.signal),
    deps.store.findLatestRun('full', request.signal),
  ])
  const latest = input.scope.map((theme) => snapshots.get(theme.id)?.[0])
  const lastSearch = request.themeId === undefined ? [toLastSearch(lastFull)] : []

  request.progress?.('trading.progress.themes.evidence')

  const bundle = await buildEvidenceBundle(deps.evidence, {
    now: startedAt,
    newsSince: toNewsSince([...latest.map((snapshot) => snapshot?.run), ...lastSearch], startedAt),
    signal: request.signal,
  })

  return {
    ...input,
    startedAt,
    previousReads: new Map(
      latest.flatMap((snapshot) => snapshot?.reads.themes ?? []).map((read) => [read.themeId, read])
    ),
    bundle,
  }
}

/** The last full run, unless its search for new themes failed: then nothing has searched since. */
function toLastSearch(run: ThemeRun | undefined): ThemeRun | undefined {
  return run?.notes.some(isDiscoveryNote) === true ? undefined : run
}

/** Each entry is the run that last read one subject this run reads: a theme, or on a full run the
 *  search for new themes. News starts at the oldest of them, so no subject skips a headline, though
 *  one read more recently sees some again; a subject never read, or read without the news, takes
 *  the whole window. */
function toNewsSince(lastReads: readonly (ThemeRun | undefined)[], startedAt: number): number {
  const windowStart = startedAt - NEWS_WINDOW_DAYS * MS_PER_DAY
  const covered = lastReads.flatMap((run) =>
    run === undefined || run.gaps.includes('news') ? [] : [run.startedAt]
  )

  return covered.length === 0 || covered.length < lastReads.length
    ? windowStart
    : Math.max(Math.min(...covered), windowStart)
}

async function analyse(
  deps: ThemeRunDeps,
  context: RunContext,
  session: AnalystSession
): Promise<RunResults> {
  const { request } = context
  const updates: ThemeUpdate[] = []

  // One at a time: a research call reserves most of what the shared budget has left until it
  // settles, so a sibling running beside it would halt on a budget that is only reserved.
  for (const theme of context.scope) {
    const previous = context.previousReads.get(theme.id)

    request.progress?.('trading.progress.themes.update', { title: theme.title })
    updates.push({
      themeId: theme.id,
      result: await updateTheme(deps.analyst, {
        theme,
        bundle: context.bundle,
        session,
        ...(previous === undefined ? {} : { previous }),
      }),
    })
  }

  if (request.themeId !== undefined) {
    return toResults(updates, undefined)
  }

  request.progress?.('trading.progress.themes.discover')

  const discovery = await discoverThemes(deps.analyst, {
    themes: context.themes,
    bundle: context.bundle,
    session,
    now: context.startedAt,
  })

  return toResults(updates, discovery)
}

/** No discovery result on a focused run, which looks for no new themes. */
function toResults(
  updates: readonly ThemeUpdate[],
  discovery: AnalystResult<readonly Proposal[]> | undefined
): RunResults {
  const proposals = discovery?.kind === 'value' ? discovery.value : []
  const discoveryNotes: ThemeRunNote[] =
    discovery?.kind === 'failed' ? [{ level: 'theme', ...discovery.failure }] : []

  return {
    reads: [
      ...updates.flatMap(({ result }) => (result.kind === 'value' ? [result.value] : [])),
      ...proposals.map((proposal) => proposal.read),
    ],
    proposals,
    notes: [
      ...updates.flatMap(({ themeId, result }): ThemeRunNote[] =>
        result.kind === 'failed' ? [{ level: 'theme', themeId, ...result.failure }] : []
      ),
      ...discoveryNotes,
    ],
  }
}

/** A theme reaches the sector and company steps only on a fresh read that kept it active. */
function toChainThemes(
  themes: readonly Theme[],
  reads: readonly ThemeRead[]
): readonly ChainTheme[] {
  return themes.flatMap((theme) => {
    const read = reads.find((entry) => entry.themeId === theme.id && entry.status === 'active')

    return read === undefined ? [] : [{ theme, read }]
  })
}

/** Nothing is written until every step has answered, so a cancelled run leaves no trace. A step
 *  that failed is named in the run's notes; the rest of the run stands. Answers why a focused run
 *  could not start, and nothing once a run is recorded. */
export async function runThemes(
  deps: ThemeRunDeps,
  request: ThemeRunRequest
): Promise<ThemeLookupFailure | undefined> {
  const themes = await deps.store.listThemes(request.signal)
  const scope = resolveScope(themes, request.themeId)

  if (scope.kind !== 'scope') {
    return scope
  }

  const context = await readContext(deps, { request, themes, scope: scope.themes })
  const budget = deps.createRunBudget()
  const session = toSession(request, budget)
  const results = await analyse(deps, context, session)
  const chain = await runChain(deps, {
    themes: toChainThemes(context.themes, results.reads),
    bundle: context.bundle,
    session,
    now: context.startedAt,
    ...(request.progress === undefined ? {} : { progress: request.progress }),
  })

  assertNotAborted(request.signal)
  await recordRun(deps, { context, budget, results, chain })

  return undefined
}

async function recordRun(deps: ThemeRunDeps, finished: FinishedRun): Promise<void> {
  const { context, results, chain } = finished
  const { request } = context
  const reads = toScoredReads(
    { themes: results.reads, sectors: chain.sectorReads, stocks: chain.stockReads },
    context.bundle
  )
  const run: ThemeRun = {
    id: randomUUID(),
    ...(request.themeId === undefined ? {} : { themeId: request.themeId }),
    startedAt: context.startedAt,
    finishedAt: Date.now(),
    promptVersion: THEME_PROMPT_VERSION,
    scoreVersion: SCORE_VERSION,
    costUsd: finished.budget.spentUsd,
    gaps: [...new Set([...context.bundle.gaps, ...chain.gaps])],
    notes: [...results.notes, ...chain.notes],
  }

  await deps.store.recordRun({
    run,
    bundle: context.bundle,
    reads,
    proposals: results.proposals.map((proposal) => proposal.theme),
    signal: request.signal,
  })
  deps.logger.info('trading.themes_run_finished', {
    runId: run.id,
    themeId: run.themeId,
    reads: reads.themes.length,
    sectorReads: reads.sectors.length,
    stockReads: reads.stocks.length,
    proposals: results.proposals.length,
    failed: run.notes.length,
    costUsd: run.costUsd,
  })
}

function toSession(request: ThemeRunRequest, budget: Budget): AnalystSession {
  return {
    channel: request.channel,
    locale: request.locale,
    billingSessionId: request.billingSessionId,
    signal: request.signal,
    parent: {
      callDepth: 0,
      delegationChain: [],
      sharedBudget: budget,
      delegationQuota: createDelegationQuota(RESEARCH_DELEGATIONS),
    },
  }
}

/** Each open theme as it was last read, whichever run read it, so a focused run never hides the
 *  themes it left alone. */
export async function loadThemeReport(
  store: ThemeStore,
  signal: AbortSignal
): Promise<ThemeReport> {
  const [themes, snapshots, run, outcomes] = await Promise.all([
    store.listThemes(signal),
    store.listSnapshots(REPORT_SNAPSHOT_DEPTH, signal),
    store.findLatestRun('any', signal),
    store.listOutcomes(signal),
  ])
  const open = themes.flatMap((theme) =>
    CLOSED_THEME_STATUSES.includes(theme.status)
      ? []
      : [{ id: theme.id, history: snapshots.get(theme.id) ?? [] }]
  )
  const latest = open.flatMap(({ id, history: [last] }) =>
    last === undefined ? [] : [{ id, snapshot: last }]
  )

  return {
    themes,
    reads: mergeReads(latest.map((entry) => entry.snapshot)),
    readRuns: new Map(latest.map((entry) => [entry.id, entry.snapshot.run])),
    previous: mergeReads(open.flatMap(({ history: [, before] }) => before ?? [])),
    scorecard: buildScorecard(outcomes),
    ...(run === undefined ? {} : { run }),
  }
}

function mergeReads(snapshots: readonly ThemeSnapshot[]): ThemeRunReads {
  return {
    themes: snapshots.flatMap((snapshot) => snapshot.reads.themes),
    sectors: snapshots.flatMap((snapshot) => snapshot.reads.sectors),
    stocks: snapshots.flatMap((snapshot) => snapshot.reads.stocks),
  }
}
