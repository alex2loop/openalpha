import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

import type {
  ConfigResponse,
  ConfigValidation,
  ConfigWriteResult,
  ProviderCatalogResponse,
  ProviderTestResult,
} from '@/app/server/wire/config'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { validateBootConfigTree } from '@/app/config-tree'
import { buildProviderCatalog } from '@/app/server/cli/catalog'
import { apiError, json } from '@/app/server/http/dispatch'
import { probeConfig } from '@/core/config/load'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { isPlainRecord } from '@/core/utils/collections'

const MAX_CONFIG_BYTES = 512 * 1024

async function handleConfigGet(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { configPath } = await probeConfig({ configPath: ctx.app.configPath })
  const config: unknown = parseToml(await Bun.file(configPath).text())

  return json({ config, configPath } satisfies ConfigResponse)
}

async function handleConfigValidate(req: Request, _ctx: ApiRouteContext): Promise<Response> {
  const body: unknown = await req.json().catch(() => null)

  return json(validateBootConfigTree(body) satisfies ConfigValidation)
}

async function handleConfigPut(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const declared = Number(req.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > MAX_CONFIG_BYTES) {
    return apiError('invalid_body')
  }

  const body: unknown = await req.json().catch(() => null)

  // Validate before writing: a config that cannot resolve would take the daemon down on next boot.
  if (!(validateBootConfigTree(body).ok && isPlainRecord(body))) {
    return apiError('invalid_body')
  }

  const { configPath } = await probeConfig({ configPath: ctx.app.configPath })

  await replacePrivateFileAtomic({ path: configPath, content: stringifyToml(body) })

  return json({ ok: true, restartRequired: true } satisfies ConfigWriteResult)
}

// The catalog is static data, so this route holds no async work and no app access.
function handleProviders(_req: Request, _ctx: ApiRouteContext): Promise<Response> {
  return Promise.resolve(json(buildProviderCatalog() satisfies ProviderCatalogResponse))
}

const TEST_MAX_TOKENS = 64
const TEST_TIMEOUT_MS = 30_000
const TEST_PROMPT = 'Reply with OK.'
/** The provider accepted the key and answered; running out of room or answering nothing is not
 *  a key problem. */
const ANSWERED_CODES: ReadonlySet<string> = new Set(['output_budget_exhausted', 'empty_response'])

/** One tiny call through the primary model, so first run can tell "key refused" from "works"
 *  before the user leaves the setup screen. */
async function handleProviderTest(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const primary = ctx.app.config.models[0]

  if (primary === undefined) {
    return json({ ok: false, code: 'no_model' } satisfies ProviderTestResult)
  }

  const providerModel = { provider: primary.provider, model: primary.model }

  try {
    await ctx.app.resolve('llmChains').primary.stream(
      {
        model: primary.model,
        preferredProviderModel: providerModel,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        maxTokens: TEST_MAX_TOKENS,
        reasoningMode: 'default',
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(TEST_TIMEOUT_MS)]),
      },
      () => undefined
    )

    return json({ ok: true, model: primary.model } satisfies ProviderTestResult)
  } catch (err: unknown) {
    const code = errorCode(err)

    if (ANSWERED_CODES.has(code)) {
      return json({ ok: true, model: primary.model } satisfies ProviderTestResult)
    }

    return json({ ok: false, code } satisfies ProviderTestResult)
  }
}

/** The runtime's `LLMError.code` (auth, billing, rate, timeout, ...); the class is not exported to
 *  the host, so the code is read off the value. */
function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code
  }

  return 'fatal'
}

export const CONFIG_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/config', auth: true, handler: handleConfigGet },
  { method: 'GET', path: '/v1/providers', auth: true, handler: handleProviders },
  { method: 'POST', path: '/v1/providers/test', auth: true, handler: handleProviderTest },
  { method: 'POST', path: '/v1/config/validate', auth: true, handler: handleConfigValidate },
  { method: 'POST', path: '/v1/config', auth: true, handler: handleConfigPut },
]
