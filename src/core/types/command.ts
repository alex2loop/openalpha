import type { ChannelId } from '@/core/channels'
import type { AgentId, SessionId, UserId } from '@/core/ids'
import type { LocalizedMessageParam } from '@/core/stream-events'
import type { Locale } from '@/core/types/locale'
/**
 * Where a slash command may be invoked. `'channel'` is any channel surface
 * (Telegram, Zalo, …); `'repl'` is the CLI chat loop. A command lists every
 * surface it supports; the dispatcher refuses to run it on one it did not declare.
 */
export type CommandSurface = 'channel' | 'repl'

/**
 * Who may invoke a command. `'member'` is any paired user; `'operator'` is the
 * privileged role the invoking surface resolves. Gate enforcement is the
 * dispatcher's job, not each command's.
 */
export type CommandRole = 'member' | 'operator'

/** Whether running a command mutates operator state, costs tokens, or only reads. */
type CommandAction = 'read' | 'mutate' | 'costly'

/** A slash message key is always namespaced under `slash.` to keep catalogs flat. */
export type CommandMessageKey = `slash.${string}`

/** Author-time-scrubbed scalar a command may interpolate into a localized message. */
/** A keyed value (`{ key }`) is resolved against the locale catalog by the renderer, so a command
 *  can interpolate a coded state (e.g. an alert-disable result) without owning an i18n import. */
export type CommandMessageValue = string | number | boolean | { readonly key: string }

export type CommandMessageValues = Readonly<Record<string, CommandMessageValue>>

/**
 * One localized line a command wants rendered. The key is resolved against the
 * locale catalog; values are interpolated by the renderer. Missing keys fail
 * closed to a generic localized error and never expose the key or values.
 */
export interface CommandMessage {
  readonly key: CommandMessageKey
  readonly values?: CommandMessageValues
}

/**
 * A command's help/menu description. Built-in commands resolve a localized key;
 * plugin commands carry manifest text that surfaces treat as untrusted (scrubbed,
 * stripped of control chars, and capped before display).
 */
export type CommandDescription =
  | { readonly kind: 'localized'; readonly key: CommandMessageKey }
  | { readonly kind: 'plugin'; readonly text: string }

/** The next command a reader could run, offered by the one they just ran. A label and a command,
 *  because that is all a destination needs: a channel with a keyboard renders it as a button, one
 *  without renders it as a line the reader can type back. Nothing exists only as a button. */
export interface Affordance {
  readonly icon?: string
  readonly label: string
  readonly command: string
}

export type SlashResult =
  | {
      readonly kind: 'message'
      /** A heading the lines sit under, one level in, as every report does. */
      readonly title?: CommandMessage
      readonly messages: readonly CommandMessage[]
    }
  | {
      readonly kind: 'text'
      readonly text: string
      readonly affordances?: readonly Affordance[]
    }
  | { readonly kind: 'agent'; readonly retryMessage: string; readonly agentId?: AgentId }
  | { readonly kind: 'handled' }

/** What a slash command adds to its session transcript: the line the operator ran, and the text it
 *  answered with. Recorded as a user row and an assistant row so the next turn reads a normal
 *  exchange. */
export interface CommandExchange {
  readonly invocation: string
  readonly output: string
}

/** A long-running command reports the locale key of its current stage through this; the surface
 *  decides how to show it and may ignore it. The params name which subject the stage is about,
 *  without which concurrent work reports the same stages with nothing to tell them apart. A
 *  param may itself be a keyed message, so a stage can name a catalog value without a locale. */
export type ProgressReporter = (
  key: string,
  params?: Readonly<Record<string, string | number | LocalizedMessageParam>>
) => void

export interface SlashContext {
  readonly channel: ChannelId
  /** Stable per-inbound-request id; used as the idempotency key for non-idempotent commands. */
  readonly requestId: string
  /** The surface the command was dispatched from; compared against the command's declared surfaces. */
  readonly surface: CommandSurface
  readonly userId: UserId
  readonly sessionId: SessionId
  /** The chat the command was typed in. Agent bindings are keyed by (channel, chatId). */
  readonly chatId: string
  /** The operator role the invoking surface resolved this user to. */
  readonly role: CommandRole
  /** Already resolved by the invoking channel or CLI. A command never reads config or a process
   *  locale of its own. */
  readonly locale: Locale
  /** Owned by the invoking surface; aborts a long-running command from that same origin. */
  readonly signal: AbortSignal
  readonly args: readonly string[]
  /** Correlation id the invoker stamps on the result; opaque to the command. */
  readonly correlationId?: string
  /** Present when the surface can show incremental progress; commands treat it as fire-and-forget. */
  readonly progress?: ProgressReporter
}

/**
 * Declared by a command that runs long enough for a surface to queue it and show progress.
 * `progressKey` names the localized label shown while it runs, so no surface has to guess one.
 */
export interface LongRunningExecution {
  readonly progressKey: CommandMessageKey
}

export interface SlashInvocationPolicy {
  readonly surfaces: readonly CommandSurface[]
  readonly role: CommandRole
  readonly action: CommandAction
  readonly cooldownMs?: number
  readonly idempotencyKey?: (ctx: SlashContext) => string
  readonly execution?: LongRunningExecution
  /** What to use instead, shown where a surface this policy leaves out refuses the command. */
  readonly surfaceHint?: CommandMessageKey
  /** `'echo'` records the invocation and its `text` output in the session transcript, so the next
   *  agent turn in this session can be asked about it. Commands that only confirm a mutation, and
   *  commands that report runtime state, leave it unset. */
  readonly transcript?: 'echo'
}

export interface CommandGroup {
  readonly key: CommandMessageKey
  readonly icon: string
}

export interface SlashCommand {
  readonly name: string
  /** Used for help, dispatch logging, and locale validation. */
  readonly description: CommandDescription
  /**
   * Every key this command is allowed to emit. A result key not in this set is
   * rejected by the dispatcher and replaced with `slash.commandUnexpected`.
   */
  readonly messageKeys: readonly CommandMessageKey[]
  readonly policy: SlashInvocationPolicy
  policyFor?(args: readonly string[]): SlashInvocationPolicy
  /**
   * Candidates for the argument being typed, where `args` holds the tokens after the command name
   * and its last entry is the partial token. Pure and synchronous, like `policyFor`: a completer
   * runs on every keystroke, so it may not read a store. Return every candidate valid at the
   * position; the caller filters by prefix.
   */
  completeFor?(args: readonly string[]): readonly string[]
  /** The `/help` heading the command lists under; a command naming none lists under the general one. */
  readonly group?: CommandGroup
  /** The message a bad argument line answers with, so `/help <command>` shows the same text. A
   *  function because its values (the registered markets) are known only once the command runs. */
  usage?(): CommandMessage
  run(ctx: SlashContext): Promise<SlashResult>
}
