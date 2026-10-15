import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'

import type { CliApp } from '@/cli/types'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { TradingConfig } from '@/trading/api'
import { inspectDaemon } from '@/cli/daemon-guard'
import { terminalErrorMessage } from '@/cli/error-output'
import { ConfigError, isErrno } from '@/core/errors'
import { inspectLogDestination, isMissingLogPath } from '@/core/logging/inspection'
import { pluralKey, t } from '@/i18n'
import { resolveTradingConfig, unavailableSources } from '@/trading/api'

import type { DoctorEnvironment, DoctorProbe } from './types'

export async function probeDataDirectory(dataDir: string, locale: Locale): Promise<DoctorProbe> {
  try {
    const info = await lstat(dataDir)

    if (info.isSymbolicLink() || !info.isDirectory()) {
      return failProbe('data-dir', t(locale, 'cli.doctorDataDirNotReal'))
    }

    await access(dataDir, constants.W_OK)
    return okProbe('data-dir', dataDir)
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return warnProbe('data-dir', t(locale, 'cli.doctorDataDirFresh', { path: dataDir }))
    }

    return failProbe('data-dir', t(locale, 'cli.doctorCannotInspectDataDir'))
  }
}

export function probeLogging(file: string, locale: Locale): DoctorProbe {
  try {
    inspectLogDestination(file)
    return okProbe('logging', file)
  } catch (err: unknown) {
    if (isMissingLogPath(err)) {
      return warnProbe('logging', t(locale, 'cli.doctorLoggingFresh', { path: file }))
    }

    return failProbe('logging', logFailureDetail(err, locale))
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
}): DoctorProbe {
  const { locale } = options

  try {
    const missing = unavailableSources({
      env: options.env,
      credentialEnv: credentialEnvOf(options.config),
    })

    if (missing.length === 0) {
      return okProbe('sources', t(locale, 'cli.doctorSourcesReady'))
    }

    return warnProbe(
      'sources',
      t(locale, 'cli.doctorSourcesSkipped', {
        sources: missing.map((entry) => `${entry.source} (${entry.variable})`).join(', '),
      })
    )
  } catch (err: unknown) {
    // `[trading]` is otherwise parsed only on the boot path, so this is where an operator learns
    // their section is malformed before the daemon refuses to start on it.
    return err instanceof ConfigError
      ? failProbe('sources', terminalErrorMessage(err, locale))
      : failProbe('sources', t(locale, 'cli.doctorCannotBeInspected'))
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

  try {
    const state = await inspectDaemon(app)

    if (state === 'live') {
      return okProbe('daemon', t(locale, 'cli.doctorDaemonLive'))
    }

    if (state === 'absent') {
      return warnProbe('daemon', t(locale, 'cli.doctorDaemonAbsent'))
    }

    return failProbe('daemon', state)
  } catch {
    return failProbe('daemon', t(locale, 'cli.doctorCannotInspectDaemon'))
  }
}

// `[[models]] provider` is a free string (core/config never validates it against the catalog), so a
// typo must degrade to a fail probe here rather than throw — shared by every caller that resolves a
// model's provider against the catalog (`doctor.ts`, `online-probes.ts`), each under its own probe name.
export function unknownProviderProbe(
  name: string,
  model: ResolvedModel,
  locale: Locale
): DoctorProbe {
  return {
    name,
    status: 'fail',
    detail: t(locale, 'cli.doctorUnknownProvider', {
      provider: model.provider,
      model: model.model,
    }),
  }
}

function okProbe(name: string, detail: string): DoctorProbe {
  return { name, status: 'ok', detail }
}

function warnProbe(name: string, detail: string): DoctorProbe {
  return { name, status: 'warn', detail }
}

function failProbe(name: string, detail: string): DoctorProbe {
  return { name, status: 'fail', detail }
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
