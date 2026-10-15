import type { CliApp, Writer } from '@/cli/types'
import type { LogLevel, ResolvedConfig } from '@/core/config/resolve'
import type { Services } from '@/core/container'
import { terminalErrorMessage } from '@/cli/error-output'
import { probeConfig } from '@/core/config/load'
import { ConfigError } from '@/core/errors'

export interface PreBootOptions {
  readonly out: Writer
  readonly err: Writer
  readonly write: Writer
  readonly configPath?: string
  readonly dataDir?: string
  readonly logLevel?: LogLevel
  readonly assertResolved: (config: ResolvedConfig) => void
  readonly assertComposes: () => Promise<void>
}

export async function preBootApp(options: PreBootOptions): Promise<CliApp> {
  const probed = await probeConfig({
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    ...(options.logLevel === undefined ? {} : { logLevel: options.logLevel }),
  })

  return {
    config: probed.config,
    configPath: probed.configPath,
    // Nothing is bound without boot; reaching for a service here is a bug in the command's `needs.boot`, and this.
    resolve: <K extends keyof Services>(key: K): Services[K] => {
      throw new ConfigError(`'${String(key)}' is unavailable: this command runs without boot`)
    },
    has: () => false,
    signal: AbortSignal.any([]),
    out: options.out,
    err: options.err,
    write: options.write,
    configProbe: {
      configPath: probed.configPath,
      configError:
        probed.error === null
          ? null
          : terminalErrorMessage(probed.error, probed.config.locale.language),
      configMissing: probed.missing,
      configKeyMissing: probed.keyMissing,
      explicitConfig: options.configPath !== undefined,
      assertResolved: options.assertResolved,
      assertComposes: options.assertComposes,
    },
  }
}
