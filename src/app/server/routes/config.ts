import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

import type {
  ConfigResponse,
  ConfigValidation,
  ConfigWriteResult,
  ProviderCatalogResponse,
  ProviderTestResult,
} from '@/app/server/wire/config'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { FieldValidationError } from '@/core/field-errors'
import { validateBootConfigTree } from '@/app/config-tree'
import { buildProviderCatalog } from '@/app/server/cli/catalog'
import { isApiExposed } from '@/app/server/exposure'
import { apiError, json } from '@/app/server/http/dispatch'
import {
  cliOnlyChanges,
  exposedOnlyChanges,
  REDACTED_SECRET,
  redactedPaths,
  toRedactedConfig,
  toRestoredConfig,
} from '@/app/server/routes/config-guard'
import { fieldsRefusal, readJsonBody } from '@/app/server/routes/params'
import { saveEditedConfig } from '@/cli/api'
import { probeConfig } from '@/core/config/load'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { isPlainRecord } from '@/core/utils/collections'
import { hashString } from '@/core/utils/hash'
import { bindLocale } from '@/i18n'

const MAX_CONFIG_BYTES = 512 * 1024
const CLI_ONLY_KIND = 'config_cli_only'
const SECRET_HIDDEN_KIND = 'config_secret_hidden'
const SERVER_ONLY_KIND = 'config_server_only'
const TESTED_MODEL_KEYS = ['base_url', 'api_key_env'] as const
// Carries the `version` a GET answered; a write sent without it is not checked.
const IF_MATCH_HEADER = 'if-match'

async function handleConfigGet(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const { configPath } = await probeConfig({ configPath: ctx.app.configPath })
  const text = await readDiskText(configPath)
  const config = toRedactedConfig(toDiskTree(text))

  return json({
    config,
    configPath,
    redacted: REDACTED_SECRET,
    version: hashString(text),
  } satisfies ConfigResponse)
}

// Answers what a save of the same body would: the boot check, then every field a write refuses.
async function handleConfigValidate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body: unknown = await readJsonBody(req, MAX_CONFIG_BYTES)
  const { configPath } = await probeConfig({ configPath: ctx.app.configPath })
  const disk = await readDiskConfig(configPath)
  const restored = toRestoredConfig(body, disk)
  const checked = validateBootConfigTree(restored)
  const refusals = isPlainRecord(restored)
    ? writeRefusals(restored, disk, isExposed(ctx, restored, disk))
    : []

  if (refusals.length === 0) {
    return json(checked satisfies ConfigValidation)
  }

  const { translate } = bindLocale(ctx.app.config.locale.language)
  const refused = refusals.flatMap((refusal) =>
    refusal.fields.map(({ path, message }) => ({
      path,
      message: translate(message.key, message.params),
      refused: true as const,
    }))
  )

  return json({
    ok: false,
    issues: [...(checked.ok ? [] : checked.issues), ...refused],
  } satisfies ConfigValidation)
}

async function handleConfigPut(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const declared = Number(req.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > MAX_CONFIG_BYTES) {
    return apiError('invalid_body')
  }

  const { configPath, missing } = await probeConfig({ configPath: ctx.app.configPath })
  const text = await readDiskText(configPath)
  const expected = req.headers.get(IF_MATCH_HEADER)

  // A tree read before another edit landed would put that edit back as it was, so it is refused.
  if (expected !== null && expected !== hashString(text)) {
    return apiError(
      'conflict',
      bindLocale(ctx.app.config.locale.language).translate('errors.configChanged')
    )
  }

  const disk = toDiskTree(text)
  const body = toRestoredConfig(await readJsonBody(req, MAX_CONFIG_BYTES), disk)

  // Validate before writing: a config that cannot resolve would take the daemon down on next boot.
  if (!(validateBootConfigTree(body).ok && isPlainRecord(body))) {
    return apiError('invalid_body')
  }

  const [refusal] = writeRefusals(body, disk, isExposed(ctx, body, disk))

  if (refusal !== undefined) {
    throw refusal
  }

  const after = stringifyToml(body)

  // The rewrite drops comments, so an existing file stays beside the new one as it was.
  if (missing) {
    await replacePrivateFileAtomic({ path: configPath, content: after })
  } else {
    await saveEditedConfig(configPath, { before: text, after })
  }

  return json({
    ok: true,
    restartRequired: true,
    version: hashString(after),
  } satisfies ConfigWriteResult)
}

/** The file as it stands; a missing one reads as empty, so every CLI-only key counts as new. */
async function readDiskConfig(configPath: string): Promise<Record<string, unknown>> {
  return toDiskTree(await readDiskText(configPath))
}

function toDiskTree(text: string): Record<string, unknown> {
  return text === '' ? {} : parseToml(text)
}

async function readDiskText(configPath: string): Promise<string> {
  const file = Bun.file(configPath)

  return (await file.exists()) ? await file.text() : ''
}

// Set on disk or in the write but not yet booted counts too: a restart would expose the daemon with
// whatever channel access the same write let through.
function isExposed(
  ctx: ApiRouteContext,
  body: Record<string, unknown>,
  disk: Record<string, unknown>
): boolean {
  return isApiExposed(ctx.app.config.api) || [body, disk].some(hasPublicUrl)
}

/** As above, for a write that carries no config: the booted `[api]`, or the file's for the next
 *  start. Shared by every route that writes a secret. */
export async function isExposedOnDisk(ctx: ApiRouteContext): Promise<boolean> {
  if (isApiExposed(ctx.app.config.api)) {
    return true
  }

  const { configPath } = await probeConfig({ configPath: ctx.app.configPath })

  return hasPublicUrl(await readDiskConfig(configPath))
}

function hasPublicUrl(tree: Record<string, unknown>): boolean {
  return isPlainRecord(tree.api) && tree.api.public_url !== undefined
}

// What a write may not carry, a secret still hidden first: each refusal names all its fields.
function writeRefusals(
  body: Record<string, unknown>,
  disk: Record<string, unknown>,
  exposed: boolean
): readonly FieldValidationError[] {
  const hidden = redactedPaths(body)
  const changed = cliOnlyChanges(body, disk)
  const serverOnly = exposed ? exposedOnlyChanges(body, disk) : []

  return [
    ...(hidden.length > 0 ? [fieldsRefusal(hidden, SECRET_HIDDEN_KIND)] : []),
    ...(changed.length > 0 ? [fieldsRefusal(changed, CLI_ONLY_KIND)] : []),
    ...(serverOnly.length > 0 ? [fieldsRefusal(serverOnly, SERVER_ONLY_KIND)] : []),
  ]
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

  assertSavedModel(await readJsonBody(req), {
    base_url: primary.baseUrl,
    api_key_env: primary.apiKeyEnv,
  })

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

/** The test runs the saved primary model only: a body naming another address or key variable is
 *  refused, so a page token cannot send a key somewhere new. */
function assertSavedModel(
  body: unknown,
  saved: Readonly<Record<(typeof TESTED_MODEL_KEYS)[number], string | undefined>>
): void {
  const changed = TESTED_MODEL_KEYS.filter(
    (key) => isPlainRecord(body) && key in body && body[key] !== saved[key]
  )

  if (changed.length > 0) {
    throw fieldsRefusal(changed, CLI_ONLY_KIND)
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
