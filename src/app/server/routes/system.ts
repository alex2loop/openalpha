import type {
  BriefScheduleWire,
  CommandList,
  CostReport,
  DoctorCheck,
  DoctorReport,
  HealthResponse,
  StatePayload,
  UpdateResponse,
} from '@/app/server/wire/system'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import { createTokenFile, findProviderById } from '@/ai/api'
import { apiTokenPath } from '@/app/server/http/auth'
import { buildCapabilities } from '@/app/server/http/capabilities'
import { apiError, json } from '@/app/server/http/dispatch'
import { toBriefScheduleWire } from '@/app/server/mappers/brief'
import { localeOf } from '@/app/server/routes/params'
import { CONTRACT_VERSION } from '@/app/server/wire/socket'
import { readReleaseStatus } from '@/cli/api'
import { describeCommand } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { probeConfig } from '@/core/config/load'
import { operatorMessageOf } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'
import { tradingDay } from '@/trading/api'

// The only unauthenticated route. It answers 'ready' unconditionally: the api starts as the last
// daemon step, so a socket that connects at all is talking to a booted daemon.
function handleHealth(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return Promise.resolve(
    json({
      ok: true,
      status: 'ready',
      version: BRAND.version,
      contractVersion: CONTRACT_VERSION,
      capabilities: buildCapabilities(ctx.app),
    } satisfies HealthResponse)
  )
}

async function handleState(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { app } = ctx
  const [todayUsd, jobs, brief] = await Promise.all([
    app.resolve('llmAttemptStore').totalFor('day', Date.now()),
    app.resolve('jobStore').list(),
    readBriefSchedule(app, req.signal),
  ])

  return json({
    version: BRAND.version,
    health: { running: true, pid: process.pid },
    cost: { todayUsd },
    // Job carries `id` plus fields the client passes through verbatim; the spread produces the
    // open shape ScheduleRow declares (an interface has no implicit index signature).
    schedules: jobs.map((job) => ({ ...job })),
    capabilities: buildCapabilities(app),
    timeZone: app.config.locale.timezone,
    ...(brief === undefined ? {} : { brief }),
  } satisfies StatePayload)
}

// The state is polled every few seconds, so the brief read can never fail the whole payload.
async function readBriefSchedule(
  app: App,
  signal: AbortSignal
): Promise<BriefScheduleWire | undefined> {
  if (!app.has('tradingHost')) {
    return undefined
  }

  try {
    const delivery = await app.resolve('tradingHost').getBriefDelivery({ signal })

    return delivery === null ? undefined : toBriefScheduleWire(delivery)
  } catch (err: unknown) {
    // A client that hung up mid-read is not a failure of the read.
    if (!signal.aborted) {
      app.resolve('logger').warn('api.brief-schedule-failed', { err: formatErrForLog(err) })
    }

    return undefined
  }
}

async function handleUpdate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const status = await readReleaseStatus(ctx.app.config, { now: Date.now(), signal: req.signal })

  return json(
    (status === null
      ? { enabled: false, current: BRAND.version, latest: null, url: null, checkedAt: 0 }
      : { enabled: true, ...status }) satisfies UpdateResponse
  )
}

// The same catalog the CLI and the channels render — one registry, three surfaces.
function handleCommands(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const locale = bindLocale(localeOf(ctx))
  const commands = ctx.app
    .resolve('commandCatalog')
    .all()
    .map((cmd) => ({ name: `/${cmd.name}`, summary: describeCommand(locale, cmd.description) }))

  return Promise.resolve(json({ commands } satisfies CommandList))
}

type Translate = ReturnType<typeof bindLocale>['translate']

/** The checks the CLI's `doctor` runs offline, with its words: `detail` is shown as written. */
async function handleDoctor(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { app } = ctx
  const { translate } = bindLocale(app.config.locale.language)
  const [config, database, providers, apiToken] = await Promise.all([
    resolveConfigCheck(app, translate),
    resolveDatabaseCheck(app, translate),
    resolveProviderChecks(app, translate),
    resolveApiTokenCheck(app, translate),
  ])

  return json({ checks: [config, database, ...providers, apiToken] } satisfies DoctorReport)
}

async function resolveConfigCheck(app: App, translate: Translate): Promise<DoctorCheck> {
  const probed = await probeConfig({ configPath: app.configPath })

  return probed.error === null
    ? { name: 'config', ok: true, detail: probed.configPath }
    : { name: 'config', ok: false, detail: configErrorText(probed.error, translate) }
}

function configErrorText(err: Error, translate: Translate): string {
  const operator = operatorMessageOf(err)

  return operator === undefined ? err.message : translate(operator.key, operator.params)
}

async function resolveDatabaseCheck(app: App, translate: Translate): Promise<DoctorCheck> {
  try {
    await app.resolve('storage').query('SELECT 1', [])

    return { name: 'database', ok: true, detail: translate('cli.doctorEndpointReachable') }
  } catch {
    return { name: 'database', ok: false, detail: translate('cli.doctorCannotConnectDatabase') }
  }
}

// resolvers/model.ts rejects a *named* api_key_env whose value is unset or empty, so a standard
// provider only ever reaches here with a real key or with apiKey entirely undefined. A subscription
// provider carries no key at all; it is authenticated by a login, whose token file is read here.
function resolveProviderChecks(app: App, translate: Translate): Promise<readonly DoctorCheck[]> {
  return Promise.all(
    app.config.models.map(async (model): Promise<DoctorCheck> => {
      const name = `provider: ${model.provider}`
      const params = { provider: model.provider }

      if (findProviderById(model.provider)?.authKind === 'oauth_subscription') {
        const login = await createTokenFile(app.config.paths.dataDir, model.provider).read()

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
      }

      const ok = model.apiKey !== undefined && model.apiKey !== ''
      const key = ok ? 'cli.doctorApiKeyPresent' : 'cli.doctorApiKeyNotSet'

      return { name, ok, detail: translate(key, params) }
    })
  )
}

async function resolveApiTokenCheck(app: App, translate: Translate): Promise<DoctorCheck> {
  const name = 'api: token'
  const tokenEnv = app.config.api.tokenEnv

  // The API refuses to start on an unset or short token_env, so a daemon answering here has it.
  if (tokenEnv !== undefined) {
    return { name, ok: true, detail: tokenEnv }
  }

  const path = apiTokenPath(app.config.paths.dataDir)
  const ok = await Bun.file(path).exists()

  return { name, ok, detail: ok ? path : translate('cli.doctorNotCreatedYet') }
}

const MS_PER_DAY = 86_400_000
const MAX_RANGE_DAYS = 366

async function handleCost(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const range = parseRange(query.get('from'), query.get('to'))

  if (range === null) {
    return apiError('invalid_body')
  }

  const spend = ctx.app.resolve('spendReader')
  const [totalUsd, rows, days] = await Promise.all([
    spend.forRange(range),
    spend.breakdownForRange(range),
    spend.dailyForRange(range),
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
  { method: 'GET', path: '/v1/commands', auth: true, handler: handleCommands },
  { method: 'GET', path: '/v1/doctor', auth: true, handler: handleDoctor },
  { method: 'GET', path: '/v1/cost', auth: true, handler: handleCost },
  { method: 'GET', path: '/v1/update', auth: true, handler: handleUpdate },
]
