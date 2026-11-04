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
import { type BrowserOverrides, SHIPPED_TIERS, TierOverridesSchema } from '@/app/browser/config'
import {
  assertCustomVenues,
  assertRowsStay,
  CustomVenuesSchema,
  parseCustomVenues,
} from '@/app/browser/custom-venues'
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

/** The sections the browser keeps: the model tiers and the hand-traded venues a visitor may change. */
const TIERS_SECTION = 'model_tiers'
const VENUES_SECTION = 'custom_venues'
const MAX_BODY_BYTES = 16 * 1024
// There is no file and no secret in what this group serves: the fields the contract carries stay empty.
const NO_FILE = ''

// A save names the sections it changes; the others keep what they hold.
const ConfigBodySchema = z.strictObject({
  [TIERS_SECTION]: TierOverridesSchema.optional(),
  [VENUES_SECTION]: CustomVenuesSchema.optional(),
})

interface OverrideSection<T> {
  readonly name: string
  readonly empty: T
  /** The value a stored payload holds, or `undefined` when it is not one this edition boots with. */
  readonly accept: (value: unknown) => T | undefined
}

const TIERS: OverrideSection<BrowserOverrides['tiers']> = {
  name: TIERS_SECTION,
  empty: {},
  accept: (value) => {
    const parsed = TierOverridesSchema.safeParse(value)

    return parsed.success ? parsed.data : undefined
  },
}

const VENUES: OverrideSection<BrowserOverrides['venues']> = {
  name: VENUES_SECTION,
  empty: [],
  accept: parseCustomVenues,
}

/** The overrides saved before this start, or none: a section that no longer parses is ignored, so a
 *  bad row can never keep the page from opening. */
export async function readBrowserOverrides(
  store: ConfigOverrideStore,
  logger: Logger,
  signal: AbortSignal
): Promise<BrowserOverrides> {
  const [tiers, venues] = await Promise.all([
    readSection(store, TIERS, { logger, signal }),
    readSection(store, VENUES, { logger, signal }),
  ])

  return { tiers, venues }
}

async function readSection<T>(
  store: ConfigOverrideStore,
  section: OverrideSection<T>,
  context: { readonly logger: Logger; readonly signal: AbortSignal }
): Promise<T> {
  const payload = await store.read(section.name, context.signal)

  if (payload === undefined) {
    return section.empty
  }

  const accepted = section.accept(parseJson(payload))

  if (accepted === undefined) {
    context.logger.warn('browser.config_override_invalid', { section: section.name })
  }

  return accepted ?? section.empty
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON: it fails the section's schema like any other payload that is not its shape.
    return undefined
  }
}

function toConfigView({ tiers, venues }: BrowserOverrides): Record<string, unknown> {
  return { [TIERS_SECTION]: { ...SHIPPED_TIERS, ...tiers }, [VENUES_SECTION]: venues }
}

async function handleConfigGet(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const config = toConfigView(
    await readBrowserOverrides(
      ctx.app.resolve('configOverrides'),
      ctx.app.resolve('logger'),
      req.signal
    )
  )

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

  const store = ctx.app.resolve('configOverrides')
  const { model_tiers: tiers, custom_venues: venues } = parsed.data
  const now = Date.now()

  if (venues !== undefined) {
    await assertVenueChange(ctx, venues, req.signal)
    await store.write(VENUES_SECTION, JSON.stringify(venues), now)
  }

  if (tiers !== undefined) {
    await store.write(TIERS_SECTION, JSON.stringify(tiers), now)
  }

  const saved = await readBrowserOverrides(store, ctx.app.resolve('logger'), req.signal)

  return json({
    ok: true,
    restartRequired: true,
    version: hashString(JSON.stringify(toConfigView(saved))),
  } satisfies ConfigWriteResult)
}

async function assertVenueChange(
  ctx: ApiRouteContext,
  after: BrowserOverrides['venues'],
  signal: AbortSignal
): Promise<void> {
  assertCustomVenues(after)

  const { venues: before } = await readBrowserOverrides(
    ctx.app.resolve('configOverrides'),
    ctx.app.resolve('logger'),
    signal
  )
  const rows = await ctx.app.resolve('tradingStores').ledger.listAll(signal)

  assertRowsStay({ before, after, rows })
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
 *  daemon's, over the browser database instead of a file; and what the browser answered about
 *  keeping the data. */
export const BROWSER_CONFIG_GROUP: ApiRouteGroup = { name: 'config', routes: CONFIG_ROUTES }
