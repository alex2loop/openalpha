import type { Locale } from '@/core/types/locale'

/** A contributed CLI text key is always namespaced under `cliHelp.` to keep catalogs flat —
 *  the terminal analog of `CommandMessageKey`. Structural here; catalog membership is asserted
 *  at composition by the CLI's contributed-command gate. */
type CliTextKey = `cliHelp.${string}`

interface CliText {
  readonly key: CliTextKey
  readonly params?: Readonly<Record<string, string | number>>
}

/** Positional grammar only — no contributed command needs flags yet; widen alongside the first
 *  consumer that does. Field meanings match the CLI's own `Spec` (`cli/args.ts`), which this is
 *  a structural subset of. */
interface CliArgSpec {
  readonly positional?: readonly string[]
  readonly positionalOptional?: boolean
  readonly positionalRest?: string
}

export type CliArgValue = string | readonly string[] | undefined

/** Parsed positionals keyed by their `CliArgSpec` names. Only reached when parsing produced no
 *  usage issues — the surface rejects those before `run`. */
export interface CliParsedArgs {
  readonly [name: string]: CliArgValue
}

type CliWriter = (line: string) => void

/** What a contributed command may touch at run time. Locale arrives resolved — a command never
 *  reads config or a process locale of its own (same rule as `SlashContext.locale`). Services are
 *  closed over at contribution time, never located through a container handle. */
export interface CliContext {
  readonly locale: Locale
  readonly signal: AbortSignal
  readonly out: CliWriter
  readonly err: CliWriter
}

/** A CLI command contributed through the container (`cliCommands` service). Always runs after a
 *  full boot under the CLI's default admission needs.
 *
 *  This contract is deliberately poor and `scripts/check-cli-contract.ts` keeps it that way: a
 *  command that wants flags, colors, `Needs`, or daemon gating is promoted to a built-in in
 *  `cli/registry.ts` — the contract is never widened to follow it. Two parallel command systems
 *  is the failure mode this rule prevents. */
export interface CliCommandDef {
  readonly name: string
  readonly summary: CliText
  readonly spec?: CliArgSpec
  run(args: CliParsedArgs, ctx: CliContext): Promise<number> | number
}
