import { z } from 'zod'

import type { CliApp } from '@/cli/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { TradingConfig } from '@/trading/api'
import {
  parseZaloPersonalConfig,
  readZaloPersonalCredentials,
  resolveSecret,
  type ZaloPersonalBlocker,
  type ZaloPersonalChannelConfig,
  zaloPersonalBlocker,
} from '@/channels/api'
import { type Command, createCommand, hasConfigError } from '@/cli/command'
import { getEnv, isQuiet } from '@/cli/env'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { fail, success } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { probeConfig } from '@/core/config/load'
import { type MessageKey, pluralKey, t } from '@/i18n'
import { MIGRATIONS } from '@/persistence/api'

import type { DoctorEnvironment, DoctorProbe } from './types'
import { probeComposition } from './composition-probe'
import { probeDatabase } from './database-probe'
import { CHECK_NAMES, type CheckName, checkLabel, subjectLabel } from './labels'
import {
  probeDaemon,
  probeDataDirectory,
  probeLogging,
  probeSources,
  tradingConfigOf,
} from './local-probes'
import { probeModels } from './model-probes'
import { probeBotTokenCheck, probeProviders, probeWebSearch } from './online-probes'
import { labelWidthOf, renderDoctorProbe } from './render'
import { probeSafety } from './safety-probe'
import { probeVenueKeys } from './venue-probes'
import { probeVersion } from './version-probe'

const EXIT_ISSUES_FOUND = 1
const TOKEN_CREDENTIAL_CHANNELS: ReadonlySet<string> = new Set(['telegram', 'zalo'])
const ZALO_PERSONAL_CHANNEL = 'zalo_personal'
const ZALO_PERSONAL_BLOCKER_KEYS = {
  disabled: 'cli.doctorChannelDisabled',
  ban_risk_not_accepted: 'cli.doctorZaloPersonalRiskNotAccepted',
  no_allowed_ids: 'cli.doctorZaloPersonalNoAllowedIds',
} as const satisfies Record<ZaloPersonalBlocker, MessageKey>

const channelConfigSchema = z.looseObject({
  enabled: z.boolean().optional(),
  token_env: z.string().optional(),
  token_file: z.string().optional(),
  dm_policy: z.enum(['pairing', 'allowlist', 'disabled']).optional(),
})

const addressingSchema = z.looseObject({
  enabled: z.boolean().optional(),
  allowed_ids: z.array(z.union([z.string(), z.number()])).optional(),
  fallback_chat_id: z.string().optional(),
})

interface DoctorContext {
  readonly app: CliApp
  readonly online: boolean
  readonly env: DoctorEnvironment
  readonly locale: Locale
}

type CheckRunner = () => Promise<readonly DoctorProbe[]>

export const doctorCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.doctor,
  needs: { boot: false, configFile: 'probe' },
  spec: {
    positional: ['check'],
    positionalOptional: true,
    flags: {
      online: {
        type: 'boolean',
        describe: { key: 'cliHelp.flagDoctorOnline' },
      },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const selected = typeof args.check === 'string' ? args.check : undefined

    if (selected !== undefined && !isCheckName(selected)) {
      return usage(app, t(locale, 'cli.doctorCheckInvalid', { names: CHECK_NAMES.join(', ') }))
    }

    const probes = await runProbes(app, {
      online: args.online === true,
      ...(selected === undefined ? {} : { selected }),
    })
    const quiet = isQuiet()
    const visible = quiet ? probes.filter((probe) => probe.status === 'fail') : probes

    const labelWidth = labelWidthOf(visible)

    for (const probe of visible) {
      app.out(renderDoctorProbe(probe, labelWidth))
    }

    const failed = probes.filter((probe) => probe.status === 'fail')

    if (quiet) {
      return failed.length === 0 ? 0 : EXIT_ISSUES_FOUND
    }

    app.out('')

    if (failed.length === 0) {
      app.out(success(t(locale, 'cli.doctorNoProblems')))

      return 0
    }

    app.err(
      fail(
        t(
          locale,
          pluralKey(failed.length, 'cli.doctorProblemsFoundOne', 'cli.doctorProblemsFound'),
          { count: failed.length }
        )
      )
    )

    return EXIT_ISSUES_FOUND
  },
})

async function runProbes(
  app: CliApp,
  options: { readonly online: boolean; readonly selected?: CheckName }
): Promise<readonly DoctorProbe[]> {
  const locale = app.config.locale.language
  const context: DoctorContext = { app, online: options.online, env: getEnv(), locale }
  const checks = createCheckRegistry(context)
  const selectedChecks: readonly (readonly [CheckName, CheckRunner])[] =
    options.selected === undefined
      ? CHECK_NAMES.map((name): readonly [CheckName, CheckRunner] => [name, checks[name]])
      : [[options.selected, checks[options.selected]]]
  const rows = await Promise.all(selectedChecks.map(([name, run]) => runProbe(name, run, locale)))

  return rows.flat()
}

async function runProbe(
  name: CheckName,
  run: CheckRunner,
  locale: Locale
): Promise<readonly DoctorProbe[]> {
  try {
    return await run()
  } catch {
    return [
      {
        name: checkLabel(locale, name),
        status: 'fail',
        detail: t(locale, 'cli.doctorProbeFailed'),
      },
    ]
  }
}

function createCheckRegistry(ctx: DoctorContext): Readonly<Record<CheckName, CheckRunner>> {
  const config = ctx.app.config
  const locale = ctx.locale
  // A config whose only fault is an unset key still loads: the key is reported under models.
  const configFailed = hasConfigError(ctx.app) && ctx.app.configProbe?.configKeyMissing !== true
  const trading = tradingConfigOf(config)

  return {
    config: async () => [await probeConfiguration(ctx.app, locale)],
    models: async () =>
      configFailed ? awaitingConfig('models', locale) : probeModels(config, ctx.env, locale),
    'data-dir': async () => [await probeDataDirectory(config.paths.dataDir, locale)],
    logging: async () => [probeLogging(config.log.file, locale)],
    database: async () => [await probeDatabase(databaseProbeOptions(ctx, trading))],
    daemon: async () => [await probeDaemon(ctx.app)],
    channels: async () => await probeChannels(config, ctx.env, locale),
    delivery: async () => [probeDeliveryAddressing(config, locale)],
    sources: async () => probeSources({ config, env: ctx.env, locale }),
    trading: async () =>
      configFailed || trading === undefined
        ? awaitingConfig('trading', locale)
        : [await probeComposition(ctx.app, locale)],
    safety: async () => probeSafety(config, trading, locale),
    venues: async () => probeVenueKeys({ config, online: ctx.online, env: ctx.env, locale }),
    'web-search': async () => [await probeWebSearch(config, ctx.online, locale)],
    providers: async () =>
      configFailed
        ? awaitingConfig('providers', locale)
        : probeProviders({ config, online: ctx.online, env: ctx.env, locale }),
    telegram: async () =>
      probeBotTokenCheck({ channel: 'telegram', config, online: ctx.online, env: ctx.env, locale }),
    zalo: async () =>
      probeBotTokenCheck({ channel: 'zalo', config, online: ctx.online, env: ctx.env, locale }),
    version: async () => [await probeVersion(config, ctx.online, locale)],
  }
}

function databaseProbeOptions(
  ctx: DoctorContext,
  trading: TradingConfig | undefined
): Parameters<typeof probeDatabase>[0] {
  return {
    storage: ctx.app.config.storage,
    migrations: MIGRATIONS,
    online: ctx.online,
    locale: ctx.locale,
    ...(trading === undefined ? {} : { currency: trading.baseCurrency }),
  }
}

function awaitingConfig(name: CheckName, locale: Locale): readonly DoctorProbe[] {
  return [
    {
      name: checkLabel(locale, name),
      status: 'warn',
      detail: t(locale, 'cli.doctorConfigNotLoaded'),
    },
  ]
}

function isCheckName(value: string): value is CheckName {
  return CHECK_NAMES.some((name) => name === value)
}

async function probeConfiguration(app: CliApp, locale: Locale): Promise<DoctorProbe> {
  const name = checkLabel(locale, 'config')

  try {
    if (app.configProbe !== undefined) {
      const { configError, configKeyMissing, configPath } = app.configProbe

      return configError === null || configKeyMissing
        ? { name, status: 'ok', detail: configPath }
        : { name, status: 'fail', detail: configError }
    }

    const result = await probeConfig()

    return result.error === null
      ? { name, status: 'ok', detail: result.configPath }
      : { name, status: 'fail', detail: terminalErrorMessage(result.error, locale) }
  } catch {
    return { name, status: 'fail', detail: t(locale, 'cli.doctorCannotBeInspected') }
  }
}

async function probeChannels(
  config: ResolvedConfig,
  env: DoctorEnvironment,
  locale: Locale
): Promise<readonly DoctorProbe[]> {
  const entries = Object.entries(config.channels)

  if (entries.length === 0) {
    return [
      {
        name: checkLabel(locale, 'channels'),
        status: 'ok',
        detail: t(locale, 'cli.doctorChannelsNoneConfigured'),
      },
    ]
  }

  return await Promise.all(
    entries.map(([channel, raw]) =>
      channel === ZALO_PERSONAL_CHANNEL
        ? probeZaloPersonal({ raw, dataDir: config.paths.dataDir, locale })
        : probeChannel({ channel, raw, env, locale })
    )
  )
}

// Zalo Personal has no token: it needs the ban-risk opt-in, an allowlist and a saved QR login, and
// the daemon only logs which one is missing.
async function probeZaloPersonal(options: {
  readonly raw: unknown
  readonly dataDir: string
  readonly locale: Locale
}): Promise<DoctorProbe> {
  const { locale } = options
  const name = subjectLabel(locale, 'channel', ZALO_PERSONAL_CHANNEL)
  let config: ZaloPersonalChannelConfig

  try {
    config = parseZaloPersonalConfig(options.raw)
  } catch {
    return { name, status: 'fail', detail: t(locale, 'cli.doctorChannelInvalidConfig') }
  }

  const blocker = zaloPersonalBlocker(config)

  if (blocker !== undefined) {
    return { name, status: 'warn', detail: t(locale, ZALO_PERSONAL_BLOCKER_KEYS[blocker]) }
  }

  const credentials = await readZaloPersonalCredentials({
    dataDir: options.dataDir,
    profile: config.profile,
  })

  if (credentials === undefined) {
    return {
      name,
      status: 'fail',
      detail: t(locale, 'cli.doctorZaloPersonalNotLinked', {
        profile: config.profile,
        brand: BRAND.name,
      }),
    }
  }

  return { name, status: 'ok', detail: t(locale, 'cli.doctorChannelEnabled') }
}

function probeChannel(options: {
  readonly channel: string
  readonly raw: unknown
  readonly env: DoctorEnvironment
  readonly locale: Locale
}): DoctorProbe {
  const parsed = channelConfigSchema.safeParse(options.raw)
  const name = subjectLabel(options.locale, 'channel', options.channel)

  if (!parsed.success) {
    return {
      name,
      status: 'fail',
      detail: t(options.locale, 'cli.doctorChannelInvalidConfig'),
    }
  }

  const data = parsed.data

  if (data.enabled === false) {
    return {
      name,
      status: 'warn',
      detail: t(options.locale, 'cli.doctorChannelDisabled'),
    }
  }

  const hasTokenConfig = data.token_env !== undefined || data.token_file !== undefined

  if (TOKEN_CREDENTIAL_CHANNELS.has(options.channel) || hasTokenConfig) {
    const token = resolveSecret(data, options.env)

    if (token === '') {
      return {
        name,
        status: 'fail',
        detail: t(options.locale, 'cli.doctorTokenNotResolved'),
      }
    }
  }

  return {
    name,
    status: 'ok',
    detail: t(options.locale, 'cli.doctorChannelEnabled'),
  }
}

function probeDeliveryAddressing(config: ResolvedConfig, locale: Locale): DoctorProbe {
  const ambiguous: string[] = []

  for (const [channel, raw] of Object.entries(config.channels)) {
    const parsed = addressingSchema.safeParse(raw)

    if (!parsed.success || parsed.data.enabled === false) {
      continue
    }

    const { allowed_ids, fallback_chat_id } = parsed.data

    if (fallback_chat_id === undefined && (allowed_ids?.length ?? 0) > 1) {
      ambiguous.push(`${channel} (${allowed_ids?.length} allowed ids)`)
    }
  }

  if (ambiguous.length === 0) {
    return {
      name: checkLabel(locale, 'delivery'),
      status: 'ok',
      detail: t(locale, 'cli.doctorDeliveryAddressed'),
    }
  }

  return {
    name: checkLabel(locale, 'delivery'),
    status: 'warn',
    detail: t(locale, 'cli.doctorDeliveryAmbiguous', { channels: ambiguous.join(', ') }),
  }
}
