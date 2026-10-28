import type { KeyFile } from '@/cli/env-file'
import type { Terminal } from '@/cli/terminal'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { App } from '@/core/container'
import type { MessageKey } from '@/i18n'

export type Writer = (line: string) => void

export interface LocalizedText {
  readonly key: MessageKey
  readonly params?: Readonly<Record<string, string | number>>
}

/** The entry's config probe, with --config applied — no-boot commands must not re-probe. */
export interface ConfigProbe {
  readonly configPath: string
  readonly configError: string | null
  readonly configMissing: boolean
  /** Only a model key is unset: the command runs, and a model call says which variable to set. */
  readonly configKeyMissing: boolean
  readonly explicitConfig: boolean
  /** Every refusal boot raises past core's resolve; empty for a tree the daemon would accept. */
  readonly bootRefusals: (config: ResolvedConfig) => readonly unknown[]
  /** Composes the app the way a command boots it, then disposes it, starting nothing; throws what
   *  that composition refuses (a home region no venue trades, a `default_for` on the wrong venue). */
  readonly assertComposes: () => Promise<void>
}

export interface CliApp extends App {
  /** The key file loaded before config, and which names it set. */
  readonly keyFile: KeyFile
  readonly out: Writer
  readonly err: Writer
  readonly write: Writer
  readonly terminal: Terminal
  /** Present only for daemon commands; main creates its controller before boot. */
  readonly abortDaemon?: () => void
  readonly configProbe?: ConfigProbe
}

export interface CompletionSource {
  complete(line: string): readonly string[]
}
