import type { CheckName } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'
import type { TradingConfig } from '@/trading/api'
import { CHECK_NAMES } from '@/core/types/doctor'
import { t } from '@/i18n'
import { MIGRATIONS } from '@/persistence/api'

import type { CheckedProbe, DoctorInput, DoctorProbe } from './types'
import { probeChannels, probeDeliveryAddressing } from './channel-probes'
import { probeDatabase } from './database-probe'
import { checkLabel } from './labels'
import { probeDataDirectory, probeLogging, probeSources, tradingConfigOf } from './local-probes'
import { probeModels } from './model-probes'
import { probeBotTokenCheck, probeProviders, probeWebSearch } from './online-probes'
import { probeSafety } from './safety-probe'
import { probeVenueKeys } from './venue-probes'
import { probeVersion } from './version-probe'

/** The checks that read the CLI process itself: its config probe, the PID file, a composition dry
 *  run. */
export const CLI_ONLY_CHECK_NAMES = ['config', 'daemon', 'trading'] as const

type CliOnlyCheckName = (typeof CLI_ONLY_CHECK_NAMES)[number]
type WebCheckName = Exclude<CheckName, CliOnlyCheckName>

/** The checks a `DoctorInput` feeds, in the CLI's order. */
export const WEB_CHECK_NAMES: readonly WebCheckName[] = CHECK_NAMES.filter(isWebCheckName)

export type CheckRunner = () => Promise<readonly DoctorProbe[]>

/** Runs every shared check, or only `selected`. */
export async function collectDoctorProbes(
  input: DoctorInput,
  selected?: WebCheckName
): Promise<readonly CheckedProbe[]> {
  const checks = createSharedChecks(input)
  const names = selected === undefined ? WEB_CHECK_NAMES : [selected]

  return await runChecks(
    names.map((name) => [name, checks[name]]),
    input.locale
  )
}

/** A check that throws is one failed row, so one probe never takes the report down. */
export async function runChecks(
  checks: readonly (readonly [CheckName, CheckRunner])[],
  locale: Locale
): Promise<readonly CheckedProbe[]> {
  const rows = await Promise.all(
    checks.map(async ([check, run]) => {
      const probes = await run().catch(() => failedCheck(check, locale))

      return probes.map((probe): CheckedProbe => ({ ...probe, check }))
    })
  )

  return rows.flat()
}

export function createSharedChecks(
  input: DoctorInput
): Readonly<Record<WebCheckName, CheckRunner>> {
  const { config, env, locale } = input
  const trading = tradingConfigOf(config)
  const isOnline = (name: CheckName): boolean => input.online && !input.onlineExcept.has(name)

  return {
    models: async () => probeModels(config, env, locale),
    'data-dir': async () => [await probeDataDirectory(config.paths.dataDir, locale)],
    logging: async () => [probeLogging(config.log.file, locale)],
    database: async () => [
      await probeDatabase(databaseProbeOptions(input, isOnline('database'), trading)),
    ],
    channels: async () => await probeChannels(config, env, locale),
    delivery: async () => [probeDeliveryAddressing(config, locale)],
    sources: async () => probeSources({ config, env, locale }),
    safety: async () => probeSafety(config, trading, locale),
    venues: async () => probeVenueKeys({ config, online: isOnline('venues'), env, locale }),
    'web-search': async () => [await probeWebSearch(config, isOnline('web-search'), locale)],
    providers: async () => probeProviders({ config, online: isOnline('providers'), env, locale }),
    telegram: async () =>
      probeBotTokenCheck({
        channel: 'telegram',
        config,
        online: isOnline('telegram'),
        env,
        locale,
      }),
    zalo: async () =>
      probeBotTokenCheck({ channel: 'zalo', config, online: isOnline('zalo'), env, locale }),
    version: async () => [await probeVersion(config, isOnline('version'), locale)],
  }
}

function databaseProbeOptions(
  input: DoctorInput,
  online: boolean,
  trading: TradingConfig | undefined
): Parameters<typeof probeDatabase>[0] {
  return {
    storage: input.config.storage,
    migrations: MIGRATIONS,
    online,
    locale: input.locale,
    ...(trading === undefined ? {} : { currency: trading.baseCurrency }),
  }
}

function failedCheck(check: CheckName, locale: Locale): readonly DoctorProbe[] {
  return [
    { name: checkLabel(locale, check), status: 'fail', detail: t(locale, 'cli.doctorProbeFailed') },
  ]
}

function isWebCheckName(name: CheckName): name is WebCheckName {
  return !CLI_ONLY_CHECK_NAMES.some((cliOnly) => cliOnly === name)
}

export function isCheckName(value: string): value is CheckName {
  return CHECK_NAMES.some((name) => name === value)
}
