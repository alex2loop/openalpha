import { z } from 'zod'

import type {
  ConfigResponse,
  ConfigValidation,
  ConfigWriteResult,
  ProviderCatalogResponse,
} from '@/app/server/wire/config'
import type { ApiRouteContext, ApiRouteGroup, ApiRouteSpec } from '@/app/types'
import type { Logger } from '@/core/logging/logger'
import type { ConfigOverrideStore } from '@/persistence/api'
import { findProviderById } from '@/ai/api'
import { SHIPPED_TIERS, type TierOverrides, TierOverridesSchema } from '@/app/browser/config'
import { BROWSER_AI_PROVIDERS } from '@/app/browser/keys'
import { json } from '@/app/server/http/dispatch'
import { localeOf, readJsonBody, toBodyFieldLabel } from '@/app/server/routes/params'
import { toFieldValidationError } from '@/core/field-errors'
import { hashString } from '@/core/utils/hash'
import { bindLocale } from '@/i18n'

declare module '@/core/container' {
  interface Services {
    /** What the visitor changed of the shipped config, kept in the browser database. */
    configOverrides: ConfigOverrideStore
  }
}

/** The one section the browser keeps: the model tiers a visitor may change. */
const TIERS_SECTION = 'model_tiers'
const MAX_BODY_BYTES = 16 * 1024
// There is no file and no secret in what this group serves: the fields the contract carries stay empty.
const NO_FILE = ''

const ConfigBodySchema = z.strictObject({ model_tiers: TierOverridesSchema })

/** The overrides saved before this start, or none: a payload that no longer parses is ignored, so a
 *  bad row can never keep the page from opening. */
export async function readTierOverrides(
  store: ConfigOverrideStore,
  logger: Logger,
  signal: AbortSignal
): Promise<TierOverrides> {
  const payload = await store.read(TIERS_SECTION, signal)

  if (payload === undefined) {
    return {}
  }

  const parsed = TierOverridesSchema.safeParse(parseJson(payload))

  if (!parsed.success) {
    logger.warn('browser.config_override_invalid', { section: TIERS_SECTION })
  }

  return parsed.success ? parsed.data : {}
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON: it fails the schema like any other payload that is not a set of tiers.
    return undefined
  }
}

async function handleConfigGet(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const overrides = await readTierOverrides(
    ctx.app.resolve('configOverrides'),
    ctx.app.resolve('logger'),
    req.signal
  )
  const config = { model_tiers: { ...SHIPPED_TIERS, ...overrides } }

  return json({
    config,
    configPath: NO_FILE,
    redacted: NO_FILE,
    version: hashString(JSON.stringify(config)),
  } satisfies ConfigResponse)
}

async function handleConfigValidate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = ConfigBodySchema.safeParse(await readJsonBody(req, MAX_BODY_BYTES))

  if (parsed.success) {
    return json({ ok: true } satisfies ConfigValidation)
  }

  const { translate } = bindLocale(localeOf(ctx))
  const refusal = toFieldValidationError(parsed.error, 'config', toBodyFieldLabel)

  return json({
    ok: false,
    issues: refusal.fields.map(({ path, message }) => ({
      path,
      message: translate(message.key, message.params),
    })),
  } satisfies ConfigValidation)
}

// A write lands for the next start: the page asks to stop running work and restarts the worker,
// because the config the engine runs on is frozen when it starts.
async function handleConfigPut(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = ConfigBodySchema.safeParse(await readJsonBody(req, MAX_BODY_BYTES))

  if (!parsed.success) {
    throw toFieldValidationError(parsed.error, 'config', toBodyFieldLabel)
  }

  await ctx.app
    .resolve('configOverrides')
    .write(TIERS_SECTION, JSON.stringify(parsed.data.model_tiers), Date.now())

  return json({
    ok: true,
    restartRequired: true,
    version: hashString(
      JSON.stringify({ model_tiers: { ...SHIPPED_TIERS, ...parsed.data.model_tiers } })
    ),
  } satisfies ConfigWriteResult)
}

function handleProviders(): Promise<Response> {
  const providers = BROWSER_AI_PROVIDERS.flatMap((id) => {
    const entry = findProviderById(id)

    return entry === undefined
      ? []
      : [
          {
            id: entry.id,
            displayName: entry.displayName,
            envVar: entry.apiKeyEnv,
            baseUrl: entry.baseUrl,
            transport: entry.transport,
            auth: entry.authStyle,
            ...(entry.defaultModel === undefined ? {} : { defaultModel: entry.defaultModel }),
          },
        ]
  })

  return Promise.resolve(json({ providers, catalogModels: [] } satisfies ProviderCatalogResponse))
}

const CONFIG_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/config', auth: true, handler: handleConfigGet },
  { method: 'GET', path: '/v1/providers', auth: true, handler: handleProviders },
  { method: 'POST', path: '/v1/config/validate', auth: true, handler: handleConfigValidate },
  { method: 'POST', path: '/v1/config', auth: true, handler: handleConfigPut },
]

/** The config routes the page edits the model tiers with: the same paths and shapes as the
 *  daemon's, over the browser database instead of a file. */
export const BROWSER_CONFIG_GROUP: ApiRouteGroup = { name: 'config', routes: CONFIG_ROUTES }
