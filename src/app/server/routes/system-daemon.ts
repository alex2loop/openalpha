import type { SystemHost } from '@/app/server/routes/system'
import type {
  DoctorCheck,
  DoctorReport,
  FeatureCapabilities,
  UpdateResponse,
} from '@/app/server/wire/system'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { CheckedProbe, DoctorInput } from '@/cli/api'
import type { App } from '@/core/container'
import type { CheckName } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'
import { findProviderById } from '@/ai/api'
import { createTokenFile } from '@/ai/node-api'
import { SHUTDOWN_DRAIN_MS } from '@/app/daemon'
import { apiTokenPath } from '@/app/server/http/auth'
import { apiError, json } from '@/app/server/http/dispatch'
import { localeOf } from '@/app/server/routes/params'
import { RESTART_IDLE_WAIT_MS } from '@/app/update/restart'
import {
  CLI_ONLY_CHECK_NAMES,
  canRestartInPlace,
  checkLabel,
  collectDoctorProbes,
  getEnv,
  isBackgroundLaunch,
  readDaemonDegraded,
  readReleaseStatus,
  UPGRADE_COMMAND,
  WEB_CHECK_NAMES,
} from '@/cli/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { CHECK_NAMES } from '@/core/types/doctor'
import { bindLocale, t } from '@/i18n'

const ONLINE_FLAG = '1'
const API_CHECK = 'api'
// A model call costs money, so the page's only one is the model chain's own test button.
const MODEL_CHECKS: ReadonlySet<CheckName> = new Set(['providers'])
// Providers whose unreadable login was already logged, per app: bounded by the configured models.
const unreadableLogins = new WeakMap<App, Set<string>>()

/** The daemon offers every feature but the analysis-only suggestion; what is down or unkeyed shows
 *  in `degraded` and in the per-route capabilities. */
const DAEMON_FEATURES: FeatureCapabilities = Object.freeze({
  analysisOnly: false,
  venues: true,
  channels: true,
  schedules: true,
  agents: true,
  chatgpt: true,
})

type Translate = ReturnType<typeof bindLocale>['translate']
type ProviderCheck = Pick<DoctorCheck, 'name' | 'ok' | 'detail'>

/** The daemon's answers for itself: its pid, whether it can restart, what it started without and
 *  whether a model is ready, which need the CLI, the process and the key files. */
export function createDaemonSystemHost(app: App): SystemHost {
  return {
    health: () => ({ running: true, pid: process.pid }),
    restart: () => ({
      restartable: canRestartInPlace() || isBackgroundLaunch(),
      restartIdleWaitMs: RESTART_IDLE_WAIT_MS,
      restartDrainMs: SHUTDOWN_DRAIN_MS,
    }),
    degraded: () => readDaemonDegraded(app, process.pid),
    modelReady: () => readModelReady(app),
    features: () => DAEMON_FEATURES,
  }
}

/** A model is ready when any configured one passes the check `doctor` runs on it, or when the
 *  connected client answers every call. */
async function readModelReady(app: App): ReturnType<SystemHost['modelReady']> {
  const providers = await resolveProviderChecks(
    app,
    bindLocale(app.config.locale.language).translate
  )
  const isClientModel = app.config.modelSource === 'client'
  const modelKeyEnv = isClientModel ? undefined : app.config.models[0]?.apiKeyEnv

  return {
    modelReady: isClientModel || providers.some((check) => check.ok),
    ...(modelKeyEnv === undefined ? {} : { modelKeyEnv }),
  }
}

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

export const SYSTEM_DAEMON_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/doctor', auth: true, handler: handleDoctor },
  { method: 'GET', path: '/v1/update', auth: true, handler: handleUpdate },
]
