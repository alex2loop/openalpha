import type { KeyFile } from '@/cli/env-file'
import type { Terminal } from '@/cli/terminal'
import type { CliApp } from '@/cli/types'
import type { LogLevel, ResolvedConfig } from '@/core/config/resolve'
import type { Services } from '@/core/container'
import { terminalErrorMessage } from '@/cli/error-output'
import { toTerminalWriters } from '@/cli/terminal'
import { probeConfig } from '@/core/config/load'
import { withExtensionRefusals } from '@/core/config/validate'
import { ConfigError } from '@/core/errors'

export interface PreBootOptions {
  readonly terminal: Terminal
  readonly configPath?: string
  readonly dataDir?: string
  readonly logLevel?: LogLevel
  readonly keyFile: KeyFile
  readonly bootRefusals: (config: ResolvedConfig) => readonly unknown[]
  readonly assertComposes: () => Promise<void>
}

export async function preBootApp(options: PreBootOptions): Promise<CliApp> {
  const probed = await probeConfig({
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    ...(options.logLevel === undefined ? {} : { logLevel: options.logLevel }),
  })

  return {
    keyFile: options.keyFile,
    config: probed.config,
    configPath: probed.configPath,
    // Nothing is bound without boot; reaching for a service here is a bug in the command's `needs.boot`, and this.
    resolve: <K extends keyof Services>(key: K): Services[K] => {
      throw new ConfigError(`'${String(key)}' is unavailable: this command runs without boot`)
    },
    has: () => false,
    signal: AbortSignal.any([]),
    ...toTerminalWriters(options.terminal),
    terminal: options.terminal,
    configProbe: {
      configPath: probed.configPath,
      configError:
        probed.error === null
          ? null
          : withExtensionRefusals(probed.error, options.bootRefusals)
              .map((refusal) => terminalErrorMessage(refusal, probed.config.locale.language))
              .join('\n'),
      configMissing: probed.missing,
      configKeyMissing: probed.keyMissing,
      explicitConfig: options.configPath !== undefined,
      bootRefusals: options.bootRefusals,
      assertComposes: options.assertComposes,
    },
  }
}
