import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'

import type { CliApp } from '@/cli/types'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { TradingConfig } from '@/trading/api'
import { buildUnknownProviderMessage, findProviderById } from '@/ai/api'
import { inspectDaemon } from '@/cli/daemon-guard'
import { terminalErrorMessage } from '@/cli/error-output'
import { BRAND } from '@/core/brand'
import { ConfigError, isErrno } from '@/core/errors'
import { inspectLogDestination, isMissingLogPath } from '@/core/logging/inspection'
import { bindLocale, pluralKey, t } from '@/i18n'
import { resolveTradingConfig, unavailableSources } from '@/trading/api'

import type { DoctorEnvironment, DoctorProbe, DoctorStatus } from './types'
import { checkLabel } from './labels'

export async function probeDataDirectory(dataDir: string, locale: Locale): Promise<DoctorProbe> {
  const name = checkLabel(locale, 'data-dir')

  try {
    const info = await lstat(dataDir)

    if (info.isSymbolicLink() || !info.isDirectory()) {
      return probeRow(name, 'fail', t(locale, 'cli.doctorDataDirNotReal'))
    }

    await access(dataDir, constants.W_OK)
    return probeRow(name, 'ok', dataDir)
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return probeRow(name, 'info', t(locale, 'cli.doctorDataDirFresh', { path: dataDir }))
    }

    return probeRow(name, 'fail', t(locale, 'cli.doctorCannotInspectDataDir'))
  }
}

export function probeLogging(file: string, locale: Locale): DoctorProbe {
  const name = checkLabel(locale, 'logging')

  try {
    inspectLogDestination(file)
    return probeRow(name, 'ok', file)
  } catch (err: unknown) {
    if (isMissingLogPath(err)) {
      return probeRow(name, 'info', t(locale, 'cli.doctorLoggingFresh', { path: file }))
    }

    return probeRow(name, 'fail', logFailureDetail(err, locale))
  }
}

/** A source whose credential variable is unset never registers, so its kind quietly falls through
 *  to the next provider — or, where it is the only one, drops a whole series. The registry logs
 *  that at boot, which a one-shot CLI run never writes; this is where an operator can read it.
 *  `[trading.sources]` may rename the variable, so the trading section is resolved rather than
 *  assumed: checking the default name would report a renamed-but-present credential as missing. */
export function probeSources(options: {
  readonly config: ResolvedConfig
  readonly env: DoctorEnvironment
  readonly locale: Locale
}): readonly DoctorProbe[] {
  const { locale } = options
  const name = checkLabel(locale, 'sources')

  try {
    const missing = unavailableSources({
      env: options.env,
      credentialEnv: credentialEnvOf(options.config),
    })

    if (missing.length === 0) {
      return [probeRow(name, 'ok', t(locale, 'cli.doctorSourcesReady'))]
    }

    // Optional by construction: a keyless provider covers each of these kinds.
    return missing.map((entry) =>
      probeRow(
        name,
        'info',
        t(locale, 'cli.doctorSourceOptional', {
          source: entry.source,
          variable: entry.variable,
          adds: t(locale, entry.adds),
        })
      )
    )
  } catch (err: unknown) {
    // `[trading]` is otherwise parsed only on the boot path, so this is where an operator learns
    // their section is malformed before the daemon refuses to start on it.
    return [
      probeRow(
        name,
        'fail',
        err instanceof ConfigError
          ? terminalErrorMessage(err, locale)
          : t(locale, 'cli.doctorCannotBeInspected')
      ),
    ]
  }
}

/** Undefined for a `[trading]` section that does not parse: the sources row already names it. */
export function tradingConfigOf(config: ResolvedConfig): TradingConfig | undefined {
  try {
    return resolveTradingConfig({ extensions: config.extensions, locale: config.locale })
  } catch {
    return undefined
  }
}

function credentialEnvOf(config: ResolvedConfig): TradingConfig['sourceCredentialEnv'] {
  return resolveTradingConfig({ extensions: config.extensions, locale: config.locale })
    .sourceCredentialEnv
}

export async function probeDaemon(app: CliApp): Promise<DoctorProbe> {
  const locale = app.config.locale.language
  const name = checkLabel(locale, 'daemon')

  try {
    const state = await inspectDaemon(app)

    if (state === 'live') {
      return probeRow(name, 'ok', t(locale, 'cli.doctorDaemonLive'))
    }

    if (state === 'absent') {
      return probeRow(name, 'info', t(locale, 'cli.doctorDaemonAbsent', { brand: BRAND.name }))
    }

    return probeRow(name, 'fail', state)
  } catch {
    return probeRow(name, 'fail', t(locale, 'cli.doctorCannotInspectDaemon'))
  }
}

// `[[models]] provider` is a free string (core/config never validates it against the catalog), so a
// typo must degrade to a fail probe here rather than throw — shared by every caller that resolves a
// model's provider against the catalog (`doctor.ts`, `online-probes.ts`), each under its own probe
// name.
export function unknownProviderProbes(
  models: readonly ResolvedModel[],
  name: string,
  locale: Locale
): readonly DoctorProbe[] {
  return models
    .filter((model) => findProviderById(model.provider) === undefined)
    .map((model) => unknownProviderProbe(name, model, locale))
}

export function unknownProviderProbe(
  name: string,
  model: ResolvedModel,
  locale: Locale
): DoctorProbe {
  const message = buildUnknownProviderMessage(model)

  return {
    name,
    status: 'fail',
    detail: bindLocale(locale).translate(message.key, message.params),
  }
}

function probeRow(name: string, status: DoctorStatus, detail: string): DoctorProbe {
  return { name, status, detail }
}

function logFailureDetail(err: unknown, locale: Locale): string {
  return err instanceof ConfigError ? err.message : t(locale, 'cli.doctorCannotInspectLog')
}

export function migrationsUpToDate(locale: Locale, count: number): string {
  return t(
    locale,
    pluralKey(count, 'cli.doctorMigrationsUpToDateOne', 'cli.doctorMigrationsUpToDate'),
    {
      count,
    }
  )
}
