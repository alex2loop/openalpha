import type { LocaleLookup } from '@/commands/dispatcher/render'
import type { RunId, SessionId } from '@/core/ids'
import type {
  CommandExchange,
  CommandRole,
  CommandSurface,
  ScheduledRunner,
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'

// Validates that a locale key resolves in every supported locale. Injected at composition so the
// commands module owns command validation without depending on i18n; the composition root owns the
// catalog check. Shared by the dispatcher and the boot extension collector.
export interface KeyValidator {
  resolvesEverywhere(key: string): boolean
}

export interface ResolvedSlashCommand {
  readonly command: SlashCommand
  readonly args: readonly string[]
  readonly policy: SlashInvocationPolicy
}

/** Binds a locale to the catalogs, so the dispatcher renders a `message` answer for the session's
 *  history in the session's language without importing i18n. `app` binds it. */
export type CommandLocales = (locale: Locale) => LocaleLookup

/** Consumer-side seam: the session store satisfies it, `app` binds it. Named for what it records,
 *  not for where it lands, so the store binds directly with no adapter. */
export interface CommandTranscript {
  appendCommandExchange(id: SessionId, exchange: CommandExchange): Promise<void>
}

export interface SlashDispatcher {
  register(cmd: SlashCommand): void

  /** All known commands, or just those runnable on a given surface/role (used by help). */
  all(surface?: CommandSurface, role?: CommandRole): readonly SlashCommand[]

  resolve(line: string): ResolvedSlashCommand | null

  dispatchResolved(resolved: ResolvedSlashCommand, ctx: SlashContext): Promise<SlashResult>

  dispatch(line: string, ctx: SlashContext): Promise<SlashResult | null>

  /** Stops a long-running command by its run id; false when none is in flight under it. */
  abortCommand(runId: RunId): boolean

  /** Run ids of the long-running commands in flight. */
  activeCommands(): readonly RunId[]

  /** Shows work the daemon starts on its own as a long-running command run. */
  readonly runScheduled: ScheduledRunner
}

export interface CommandCatalog {
  all(): readonly SlashCommand[]
}
