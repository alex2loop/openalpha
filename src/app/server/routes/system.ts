import type { LiveSnapshotWire } from '@/app/server/wire/live'
import type {
  CommandCompletion,
  CommandList,
  CostReport,
  DoctorCheck,
  DoctorReport,
  HealthResponse,
  StatePayload,
  UpdateResponse,
} from '@/app/server/wire/system'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { CheckedProbe, DoctorInput } from '@/cli/api'
import type { SlashCommand } from '@/commands/api'
import type { App } from '@/core/container'
import type { CheckName } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'
import { createTokenFile, findProviderById } from '@/ai/api'
import { SHUTDOWN_DRAIN_MS } from '@/app/daemon'
import { isApiExposed } from '@/app/server/exposure'
import { apiTokenPath } from '@/app/server/http/auth'
import { buildCapabilities } from '@/app/server/http/capabilities'
import { apiError, json } from '@/app/server/http/dispatch'
import { toScheduleRowWire } from '@/app/server/mappers/jobs'
import { readBriefSchedule } from '@/app/server/routes/brief-schedule'
import { localeOf } from '@/app/server/routes/params'
import { CONTRACT_VERSION } from '@/app/server/wire/socket'
import { COST_ESTIMATE_SAMPLE, MAX_COMPLETION_LINE_CHARS } from '@/app/server/wire/system'
import { RESTART_IDLE_WAIT_MS } from '@/app/update/restart'
import {
  CLI_ONLY_CHECK_NAMES,
  checkLabel,
  collectDoctorProbes,
  getEnv,
  isBackgroundLaunch,
  readDaemonDegraded,
  readReleaseStatus,
  UPGRADE_COMMAND,
  WEB_CHECK_NAMES,
} from '@/cli/api'
import { completeArguments, describeCommand, renderMessages } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { CHECK_NAMES } from '@/core/types/doctor'
import { MS_PER_DAY } from '@/core/utils/time'
import { bindLocale, t } from '@/i18n'
import { resolveChildMaxDurationMs } from '@/tools/api'
import {
  HOST_SLOW_REQUEST_TIMEOUT_MS,
  MINIMUM_TRACK_RECORD_SAMPLE,
  tradingDay,
} from '@/trading/api'

const COST_ESTIMATE_MIN_RUNS = 3
const ONLINE_FLAG = '1'
const API_CHECK = 'api'
// A model call costs money, so the page's only one is the model chain's own test button.
const MODEL_CHECKS: ReadonlySet<CheckName> = new Set(['providers'])
// Providers whose unreadable login was already logged, per app: bounded by the configured models.
const unreadableLogins = new WeakMap<App, Set<string>>()

// The only unauthenticated route. It answers 'ready' unconditionally: the api starts as the last
// daemon step, so a socket that connects at all is talking to a booted daemon.
async function handleHealth(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json({
    ok: true,
    status: 'ready',
    version: BRAND.version,
    brand: BRAND.display,
    contractVersion: CONTRACT_VERSION,
    capabilities: buildCapabilities(ctx.app),
  } satisfies HealthResponse)
}

async function handleState(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { app } = ctx
  const [todayUsd, jobs, brief, degraded, firstRun] = await Promise.all([
    app.resolve('llmAttemptStore').totalFor('day', Date.now()),
    app.resolve('jobStore').list(),
    readBriefSchedule(app, req.signal),
    readDaemonDegraded(app, process.pid),
    readFirstRun(app, req.signal),
  ])

  return json({
    version: BRAND.version,
    health: { running: true, pid: process.pid },
    cost: { todayUsd },
    // Job carries `id` plus fields the client passes through verbatim; an event job goes out with
    // `event` and without the time it is parked at.
    schedules: jobs.map(toScheduleRowWire),
    capabilities: buildCapabilities(app),
    timeZone: app.config.locale.timezone,
    locale: app.config.locale.language,
    degraded,
    ...(brief === undefined ? {} : { brief }),
    restartable: isBackgroundLaunch(),
    restartIdleWaitMs: RESTART_IDLE_WAIT_MS,
    restartDrainMs: SHUTDOWN_DRAIN_MS,
    trackRecordMinSample: MINIMUM_TRACK_RECORD_SAMPLE,
    childRunMaxMs: resolveChildMaxDurationMs(app.config.loop),
    firstRun,
    slowRequestMs: HOST_SLOW_REQUEST_TIMEOUT_MS,
    exposed: isApiExposed(app.config.api),
  } satisfies StatePayload)
}

/** A model is ready when any configured one passes the check `doctor` runs on it, or when the
 *  connected client answers every call. */
async function readFirstRun(app: App, signal: AbortSignal): Promise<StatePayload['firstRun']> {
  const { translate } = bindLocale(app.config.locale.language)
  const [setup, providers] = await Promise.all([
    app.resolve('tradingHost').getSetup(signal),
    resolveProviderChecks(app, translate),
  ])

  return {
    modelReady: app.config.modelSource === 'client' || providers.some((check) => check.ok),
    ...setup,
  }
}

async function handleLive(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(ctx.live.snapshot() satisfies LiveSnapshotWire)
}

async function handleUpdate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const status = await readReleaseStatus(ctx.app.config, { now: Date.now(), signal: req.signal })

  return json(
    (status === null
      ? {
          enabled: false,
          current: BRAND.version,
          latest: null,
          url: null,
          checkedAt: 0,
          newer: false,
          notes: [],
          upgradeCommand: UPGRADE_COMMAND,
        }
      : { enabled: true, ...status, upgradeCommand: UPGRADE_COMMAND }) satisfies UpdateResponse
  )
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

type Translate = ReturnType<typeof bindLocale>['translate']
type ProviderCheck = Pick<DoctorCheck, 'name' | 'ok' | 'detail'>

/** The CLI's `doctor` checks, with its words: `detail` is shown as written. */
async function handleDoctor(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const online = query.get('online') === ONLINE_FLAG
  const checks = await readDoctorChecks(ctx.app, { check: query.get('check'), online })

  if (checks === null) {
    const names = [...CHECK_NAMES, API_CHECK].join(', ')

    return apiError('invalid_body', t(localeOf(ctx), 'cli.doctorCheckInvalid', { names }))
  }

  return json({ checks, checkedAt: Date.now(), online } satisfies DoctorReport)
}

// Null for a check id the CLI does not know.
async function readDoctorChecks(
  app: App,
  options: { readonly check: string | null; readonly online: boolean }
): Promise<readonly DoctorCheck[] | null> {
  const { check, online } = options
  const locale = app.config.locale.language
  const input: DoctorInput = {
    config: app.config,
    env: getEnv(),
    locale,
    online,
    onlineExcept: MODEL_CHECKS,
    surface: 'page',
  }
  const apiToken = (): Promise<DoctorCheck> =>
    resolveApiTokenCheck(app, bindLocale(locale).translate)

  if (check === null) {
    const [probes, token] = await Promise.all([collectDoctorProbes(input), apiToken()])

    return [
      ...probes.map(toDoctorCheck),
      ...CLI_ONLY_CHECK_NAMES.map((name) => cliOnlyCheck(name, locale)),
      token,
    ]
  }

  if (check === API_CHECK) {
    return [await apiToken()]
  }

  const shared = WEB_CHECK_NAMES.find((name) => name === check)

  if (shared !== undefined) {
    return (await collectDoctorProbes(input, shared)).map(toDoctorCheck)
  }

  const cliOnly = CLI_ONLY_CHECK_NAMES.find((name) => name === check)

  return cliOnly === undefined ? null : [cliOnlyCheck(cliOnly, locale)]
}

function toDoctorCheck(probe: CheckedProbe): DoctorCheck {
  return {
    check: probe.check,
    name: scrubCredentials(probe.name),
    status: probe.status,
    ok: probe.status === 'ok' || probe.status === 'info',
    detail: scrubCredentials(probe.detail),
  }
}

function cliOnlyCheck(check: CheckName, locale: Locale): DoctorCheck {
  return { check, name: checkLabel(locale, check), status: 'cliOnly', ok: true }
}

// resolvers/model.ts rejects a *named* api_key_env whose value is unset or empty, so a standard
// provider only ever reaches here with a real key or with apiKey entirely undefined. A subscription
// provider carries no key at all; it is authenticated by a login, whose token file is read here.
function resolveProviderChecks(app: App, translate: Translate): Promise<readonly ProviderCheck[]> {
  return Promise.all(
    app.config.models.map(async (model): Promise<ProviderCheck> => {
      const name = `provider: ${model.provider}`
      const params = { provider: model.provider }

      if (findProviderById(model.provider)?.authKind === 'oauth_subscription') {
        return await resolveLoginCheck(app, { name, provider: model.provider }, translate)
      }

      const ok = model.apiKey !== undefined && model.apiKey !== ''
      const key = ok ? 'cli.doctorApiKeyPresent' : 'cli.doctorApiKeyNotSet'

      return { name, ok, detail: translate(key, params) }
    })
  )
}

// A token file that is not JSON throws; the state and doctor routes answer through it, so it reads
// as a login that is not usable, and the cause is logged once per provider.
async function resolveLoginCheck(
  app: App,
  target: { readonly name: string; readonly provider: string },
  translate: Translate
): Promise<ProviderCheck> {
  const { name, provider } = target
  const params = { provider }

  try {
    const login = await createTokenFile(app.config.paths.dataDir, provider).read()

    return login === undefined
      ? { name, ok: false, detail: translate('cli.doctorLoginMissing', params) }
      : {
          name,
          ok: true,
          detail: translate('cli.doctorLoginOk', {
            ...params,
            expires: new Date(login.expiresAt).toISOString(),
          }),
        }
  } catch (err: unknown) {
    const logged = unreadableLogins.get(app) ?? new Set<string>()

    unreadableLogins.set(app, logged)

    if (!logged.has(provider)) {
      logged.add(provider)
      app.resolve('logger').warn('api.login_unreadable', { provider, err: formatErrForLog(err) })
    }

    return { name, ok: false, detail: translate('cli.doctorLoginUnreadable', params) }
  }
}

async function resolveApiTokenCheck(app: App, translate: Translate): Promise<DoctorCheck> {
  const row = { check: API_CHECK, name: 'api: token' } as const
  const tokenEnv = app.config.api.tokenEnv

  // The API refuses to start on an unset or short token_env, so a daemon answering here has it.
  if (tokenEnv !== undefined) {
    return { ...row, status: 'ok', ok: true, detail: tokenEnv }
  }

  const path = apiTokenPath(app.config.paths.dataDir)
  const ok = await Bun.file(path).exists()

  return ok
    ? { ...row, status: 'ok', ok, detail: path }
    : { ...row, status: 'fail', ok, detail: translate('cli.doctorNotCreatedYet') }
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

export const SYSTEM_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/health', auth: false, handler: handleHealth },
  { method: 'GET', path: '/v1/state', auth: true, handler: handleState },
  { method: 'GET', path: '/v1/live', auth: true, handler: handleLive },
  { method: 'GET', path: '/v1/commands', auth: true, handler: handleCommands },
  { method: 'GET', path: '/v1/commands/complete', auth: true, handler: handleCommandComplete },
  { method: 'GET', path: '/v1/doctor', auth: true, handler: handleDoctor },
  { method: 'GET', path: '/v1/cost', auth: true, handler: handleCost },
  { method: 'GET', path: '/v1/update', auth: true, handler: handleUpdate },
]
