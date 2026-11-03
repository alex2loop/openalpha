import type { LiveSnapshotWire } from '@/app/server/wire/live'
import type {
  CommandCompletion,
  CommandList,
  CostReport,
  FeatureCapabilities,
  HealthResponse,
  StatePayload,
} from '@/app/server/wire/system'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { SlashCommand } from '@/commands/api'
import type { App } from '@/core/container'
import { isApiExposed } from '@/app/server/exposure'
import { buildCapabilities } from '@/app/server/http/capabilities'
import { apiError, json } from '@/app/server/http/dispatch'
import { toScheduleRowWire } from '@/app/server/mappers/jobs'
import { readBriefSchedule } from '@/app/server/routes/brief-schedule'
import { localeOf } from '@/app/server/routes/params'
import { CONTRACT_VERSION } from '@/app/server/wire/socket'
import { COST_ESTIMATE_SAMPLE, MAX_COMPLETION_LINE_CHARS } from '@/app/server/wire/system'
import { completeArguments, describeCommand, renderMessages } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { MS_PER_DAY } from '@/core/utils/time'
import { bindLocale } from '@/i18n'
import { resolveChildMaxDurationMs } from '@/tools/api'
import {
  HOST_SLOW_REQUEST_TIMEOUT_MS,
  MINIMUM_TRACK_RECORD_SAMPLE,
  tradingDay,
} from '@/trading/api'

const COST_ESTIMATE_MIN_RUNS = 3

/** What `/v1/health` and `/v1/state` ask of the process that serves them, which only that process
 *  can answer: the daemon binds its own (pid, restart, key files), a browser worker binds one
 *  that has none of those. */
export interface SystemHost {
  health(): StatePayload['health']
  restart(): Pick<StatePayload, 'restartable' | 'restartIdleWaitMs' | 'restartDrainMs'>
  degraded(): Promise<StatePayload['degraded']>
  /** Whether a model can answer, and the key variable the first one reads. */
  modelReady(): Promise<Pick<StatePayload['firstRun'], 'modelReady' | 'modelKeyEnv'>>
  features(): FeatureCapabilities
}

// The only unauthenticated route. The api binds before the subsystems start, so it answers
// `starting` until the daemon is ready; a page that sees it asks again.
async function handleHealth(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const ready = ctx.isReady()

  return json({
    ok: ready,
    status: ready ? 'ready' : 'starting',
    version: BRAND.version,
    brand: BRAND.display,
    contractVersion: CONTRACT_VERSION,
    capabilities: buildCapabilities(ctx.app),
  } satisfies HealthResponse)
}

async function handleState(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { app } = ctx
  const host = app.resolve('systemHost')
  const [todayUsd, jobs, brief, degraded, firstRun] = await Promise.all([
    app.resolve('llmAttemptStore').totalFor('day', Date.now()),
    app.resolve('jobStore').list(),
    readBriefSchedule(app, req.signal),
    host.degraded(),
    readFirstRun(app, host, req.signal),
  ])

  return json({
    version: BRAND.version,
    health: host.health(),
    cost: { todayUsd },
    // Job carries `id` plus fields the client passes through verbatim; an event job goes out with
    // `event` and without the time it is parked at.
    schedules: jobs.map(toScheduleRowWire),
    capabilities: buildCapabilities(app),
    timeZone: app.config.locale.timezone,
    locale: app.config.locale.language,
    degraded,
    ...(brief === undefined ? {} : { brief }),
    ...host.restart(),
    trackRecordMinSample: MINIMUM_TRACK_RECORD_SAMPLE,
    childRunMaxMs: resolveChildMaxDurationMs(app.config.loop),
    firstRun,
    slowRequestMs: HOST_SLOW_REQUEST_TIMEOUT_MS,
    exposed: isApiExposed(app.config.api),
  } satisfies StatePayload)
}

/** The model's readiness is the host's word; the setup is the trading host's. */
async function readFirstRun(
  app: App,
  host: SystemHost,
  signal: AbortSignal
): Promise<StatePayload['firstRun']> {
  const [setup, model] = await Promise.all([
    app.resolve('tradingHost').getSetup(signal),
    host.modelReady(),
  ])

  return { ...model, ...setup }
}

async function handleLive(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(ctx.live.snapshot() satisfies LiveSnapshotWire)
}

type CostRange = NonNullable<CommandList['commands'][number]['estimate']>

const NO_AI_ESTIMATE = Object.freeze({ lowUsd: 0, highUsd: 0, runs: 0 })

// A command that only reads, with a policy that never varies by argument, never bills a model call.
function cannotCallModel(cmd: SlashCommand): boolean {
  return cmd.policy.action === 'read' && cmd.policyFor === undefined
}

// Too few runs to say what a command usually costs is no estimate.
function toEstimate(range: CostRange | undefined): CostRange | undefined {
  return range === undefined || range.runs < COST_ESTIMATE_MIN_RUNS ? undefined : range
}

// The same catalog the CLI and the channels render — one registry, three surfaces.
async function handleCommands(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const locale = bindLocale(localeOf(ctx))
  const catalog = ctx.app.resolve('commandCatalog').all()
  const ranges = await ctx.app.resolve('runLogStore').costRangeByName(
    catalog.map((cmd) => cmd.name),
    COST_ESTIMATE_SAMPLE
  )
  const commands = catalog.map((cmd) => {
    const range = ranges.get(cmd.name)
    const estimate = cannotCallModel(cmd) ? NO_AI_ESTIMATE : toEstimate(range)

    return {
      name: `/${cmd.name}`,
      summary: describeCommand(locale, cmd.description),
      ...(estimate === undefined ? {} : { estimate }),
    }
  })

  return json({ commands } satisfies CommandList)
}

// The CLI's Tab completion over the typed line; a name still being typed or not known answers nothing.
async function handleCommandComplete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const line = new URL(req.url).searchParams.get('line') ?? ''
  const completion =
    line.length > MAX_COMPLETION_LINE_CHARS
      ? null
      : completeArguments(ctx.app.resolve('commandCatalog').all(), line)

  if (completion === null) {
    return json({ candidates: [] } satisfies CommandCompletion)
  }

  const { command, candidates } = completion
  const usage =
    command.usage === undefined
      ? undefined
      : renderMessages(bindLocale(localeOf(ctx)), { kind: 'message', messages: [command.usage()] })

  return json({ candidates, ...(usage === undefined ? {} : { usage }) } satisfies CommandCompletion)
}

const MAX_RANGE_DAYS = 366

async function handleCost(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const range = parseRange(query.get('from'), query.get('to'))

  if (range === null) {
    return apiError('invalid_body')
  }

  const spend = ctx.app.resolve('spendReader')
  const [totalUsd, rows, days, byJob] = await Promise.all([
    spend.forRange(range),
    spend.breakdownForRange(range),
    spend.dailyForRange(range),
    spend.jobsForRange(range),
  ])
  const budget = ctx.app.config.budget

  return json({
    ...range,
    totalUsd,
    caps: {
      dailyUsd: budget.maxDailyUsd,
      monthlyUsd: budget.maxMonthlyUsd,
      warnRatio: budget.softWarnRatio,
    },
    days,
    rows: rows.map((row) => ({ ...row })),
    jobs: byJob.jobs.map((job) => ({ ...job })),
    otherUsd: byJob.otherUsd,
  } satisfies CostReport)
}

// The store throws on a malformed or reversed range; refusing here keeps that a 400, not a 500.
function parseRange(
  from: string | null,
  to: string | null
): { readonly fromDay: string; readonly toDay: string } | null {
  if (from === null || to === null) {
    return null
  }

  try {
    const fromDay = tradingDay(from)
    const toDay = tradingDay(to)
    const spanDays = (Date.parse(toDay) - Date.parse(fromDay)) / MS_PER_DAY + 1

    return spanDays >= 1 && spanDays <= MAX_RANGE_DAYS ? { fromDay, toDay } : null
  } catch {
    return null
  }
}

export const SYSTEM_CORE_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/health', auth: false, handler: handleHealth },
  { method: 'GET', path: '/v1/state', auth: true, handler: handleState },
  { method: 'GET', path: '/v1/live', auth: true, handler: handleLive },
  { method: 'GET', path: '/v1/commands', auth: true, handler: handleCommands },
  { method: 'GET', path: '/v1/commands/complete', auth: true, handler: handleCommandComplete },
  { method: 'GET', path: '/v1/cost', auth: true, handler: handleCost },
]
