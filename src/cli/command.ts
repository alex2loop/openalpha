import type { ArgIssue, ParsedArgs, Spec } from '@/cli/parsing/args'
import type { CliApp, LocalizedText } from '@/cli/types'
import type { ModelSource } from '@/core/config/resolve'
import { isDaemonRunning, isDaemonStopped } from '@/cli/daemon-guard'
import { usage } from '@/cli/error-output'
import { printCommandHelp, printGroupHelp, renderLocalized } from '@/cli/help'
import { formatArgIssue } from '@/cli/parsing/arg-issue'
import { parseArgs } from '@/cli/parsing/args'
import { fail, hint, style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { ConfigError } from '@/core/errors'
import { closestName } from '@/core/utils/text'
import { t } from '@/i18n'

const HELP_FLAGS = new Set(['--help', '-h'])
const EXIT_BLOCKED = 1

export interface Needs {
  readonly boot?: boolean
  readonly bootScope?: 'full' | 'persistence'
  readonly startup?: 'hydrate' | 'migrate' | 'none'
  readonly configFile?: 'required' | 'optional' | 'probe'
  readonly daemon?: 'running' | 'stopped' | 'any'
  readonly bootMode?: 'cli' | 'daemon'
  readonly prepareDaemon?: 'none' | 'stop'
  readonly modelSource?: ModelSource
}

export interface CommandDef {
  readonly name: string
  readonly summary: LocalizedText
  readonly spec?: Spec
  readonly needs?: Needs
  validate?(args: ParsedArgs): LocalizedText | undefined
  run(args: ParsedArgs, app: CliApp): Promise<number> | number
}

export interface Command {
  readonly kind: 'cmd'
  readonly name: string
  readonly summary: LocalizedText
  needsFor(argv: readonly string[]): Promise<Required<Needs>>
  preflight(argv: readonly string[], path: readonly string[]): Promise<CommandRejection | undefined>
  exec(argv: readonly string[], app: CliApp, path: readonly string[]): Promise<number>
}

export interface Group {
  readonly kind: 'group'
  readonly name: string
  readonly summary: LocalizedText
  readonly subcommands: readonly (Command | Group)[]
  needsFor(argv: readonly string[]): Promise<Required<Needs>>
  preflight(argv: readonly string[], path: readonly string[]): Promise<CommandRejection | undefined>
  exec(argv: readonly string[], app: CliApp, path: readonly string[]): Promise<number>
}

interface GroupDef {
  readonly name: string
  readonly summary: LocalizedText
  readonly needs?: Needs
  readonly subcommands: readonly (Command | Group)[]
  // When set, a bare invocation or one starting with flags dispatches to this subcommand
  // instead of printing help — preserves flat-command UX while subcommands coexist.
  readonly default?: string
}

interface LazyCommandDef {
  readonly name: string
  readonly summary: LocalizedText
  load(): Promise<Command | Group>
}

interface Miss {
  readonly path: readonly string[]
  readonly attempted: string
}

type CommandOutput = Pick<CliApp, 'config' | 'out' | 'err'>

export const DEFAULT_NEEDS: Required<Needs> = {
  boot: true,
  bootScope: 'full',
  startup: 'hydrate',
  configFile: 'required',
  daemon: 'any',
  bootMode: 'cli',
  prepareDaemon: 'none',
  modelSource: 'config',
}
const HELP_NEEDS: Required<Needs> = {
  boot: false,
  bootScope: 'persistence',
  startup: 'none',
  configFile: 'optional',
  daemon: 'any',
  bootMode: 'cli',
  prepareDaemon: 'none',
  modelSource: 'config',
}

function resolveNeeds(needs: Needs | undefined): Required<Needs> {
  return { ...DEFAULT_NEEDS, ...needs }
}

function mergeGroupNeeds(child: Required<Needs>, parent: Required<Needs>): Required<Needs> {
  return {
    boot: child.boot && parent.boot,
    bootScope: child.bootScope,
    startup: child.startup,
    configFile: child.configFile,
    daemon: parent.daemon !== 'any' ? parent.daemon : child.daemon,
    bootMode: child.bootMode,
    prepareDaemon: child.prepareDaemon,
    modelSource: child.modelSource,
  }
}

export function createCommand(def: CommandDef): Command {
  const needs = resolveNeeds(def.needs)

  return {
    kind: 'cmd',
    name: def.name,
    summary: def.summary,
    async needsFor(argv): Promise<Required<Needs>> {
      return resolveNeedsForArgs(needs, argv)
    },
    async preflight(argv, path): Promise<CommandRejection | undefined> {
      if (hasHelp(argv)) {
        return undefined
      }

      const parsed = parseArgs(argv, def.spec ?? {})

      if (parsed.issues.length > 0) {
        return createCommandRejection((app) =>
          rejectArgs(app, { def, path, issues: parsed.issues })
        )
      }

      const validationError = def.validate?.(parsed)

      return validationError === undefined
        ? undefined
        : createCommandRejection((app) =>
            rejectValidation(app, { def, path, error: validationError })
          )
    },
    async exec(argv, app, path): Promise<number> {
      if (hasHelp(argv)) {
        printCommandHelp(def, app, path)

        return 0
      }

      const parsed = parseArgs(argv, def.spec ?? {})

      if (parsed.issues.length > 0) {
        return rejectArgs(app, { def, path, issues: parsed.issues })
      }

      const validationError = def.validate?.(parsed)

      if (validationError !== undefined) {
        return rejectValidation(app, { def, path, error: validationError })
      }

      return def.run(parsed, app)
    },
  }
}

function rejectValidation(
  output: CommandOutput,
  options: {
    readonly def: CommandDef
    readonly path: readonly string[]
    readonly error: LocalizedText
  }
): number {
  const { def, path, error } = options

  output.err(fail(renderLocalized(output.config.locale.language, error)))

  return usage(
    output,
    t(output.config.locale.language, 'cliHelp.runHelpForUsage', {
      command: runnablePath(path, def.name),
    })
  )
}

export async function admitCommand(
  needs: Required<Needs>,
  app: CliApp
): Promise<number | undefined> {
  const configError = configAdmissionError(needs.configFile, app)

  if (configError !== undefined) {
    app.err(fail(configError))

    return EXIT_BLOCKED
  }

  return (await isDaemonStateOk(needs, app)) ? undefined : EXIT_BLOCKED
}

function configAdmissionError(
  policy: Required<Needs>['configFile'],
  app: CliApp
): string | undefined {
  const probe = app.configProbe

  if (probe?.configError === null || probe === undefined) {
    return undefined
  }

  // An unset key fails the call that needs it, never the command or the daemon's boot.
  if (policy === 'probe' || probe.configKeyMissing) {
    return undefined
  }

  if (policy === 'optional' && probe.configMissing && !probe.explicitConfig) {
    return undefined
  }

  return probe.configError
}

async function isDaemonStateOk(needs: Required<Needs>, app: CliApp): Promise<boolean> {
  if (needs.daemon === 'any') {
    return true
  }

  // Only `start` is a daemon boot that wants the daemon stopped; its refusal says what to do next.
  const whenRunning = needs.bootMode === 'daemon' ? 'already-started' : 'stop-first'

  return needs.daemon === 'stopped' ? isDaemonStopped(app, whenRunning) : isDaemonRunning(app)
}

// A typo must fail before any daemon check, boot, or side effect — never reach def.run.
function rejectArgs(
  output: CommandOutput,
  options: {
    readonly def: CommandDef
    readonly path: readonly string[]
    readonly issues: readonly ArgIssue[]
  }
): number {
  for (const issue of options.issues) {
    output.err(fail(formatArgIssue(output.config.locale.language, issue)))
  }

  return usage(
    output,
    t(output.config.locale.language, 'cliHelp.runHelpForUsage', {
      command: runnablePath(options.path, options.def.name),
    })
  )
}

/** A config file that exists but failed to load leaves `app.config` the fallback, whose paths and
 *  models are not the operator's. */
export function hasConfigError(app: CliApp): boolean {
  return (app.configProbe?.configError ?? null) !== null
}

/** The operator's own config loaded, perhaps with a key still unset. */
export function hasLoadedConfig(app: CliApp): boolean {
  const probe = app.configProbe

  return probe !== undefined && (probe.configError === null || probe.configKeyMissing)
}

export function lazyCommand(def: LazyCommandDef): Command {
  let loaded: Promise<Command | Group> | undefined
  const load = (): Promise<Command | Group> => {
    loaded ??= def.load()
    return loaded
  }

  return {
    kind: 'cmd',
    name: def.name,
    summary: def.summary,
    async needsFor(argv): Promise<Required<Needs>> {
      return (await load()).needsFor(argv)
    },
    async preflight(argv, path): Promise<CommandRejection | undefined> {
      return (await load()).preflight(argv, path)
    },
    async exec(argv, app, path): Promise<number> {
      return (await load()).exec(argv, app, path)
    },
  }
}

export function createGroup(def: GroupDef): Group {
  const needs = resolveNeeds(def.needs)
  const defaultSub =
    def.default === undefined ? undefined : def.subcommands.find((sub) => sub.name === def.default)

  if (def.default !== undefined && defaultSub === undefined) {
    throw new ConfigError(`group '${def.name}' default subcommand not found: ${def.default}`)
  }

  const defaultTarget = (head: string | undefined): Command | Group | undefined => {
    if (defaultSub === undefined || (head !== undefined && HELP_FLAGS.has(head))) {
      return undefined
    }

    return head === undefined || head.startsWith('-') ? defaultSub : undefined
  }

  return {
    kind: 'group',
    name: def.name,
    summary: def.summary,
    subcommands: def.subcommands,
    needsFor: (argv) => groupNeedsFor({ def, needs, defaultTarget }, argv),
    async preflight(argv, path): Promise<CommandRejection | undefined> {
      const [head, ...rest] = argv
      const target = defaultTarget(head)

      if (target !== undefined) {
        return target.preflight(argv, [...path, def.name])
      }

      if (head === undefined || HELP_FLAGS.has(head)) {
        return undefined
      }

      const match = def.subcommands.find((sub) => sub.name === head)

      if (!match) {
        const miss = { path: [...path, def.name], attempted: head }

        return createCommandRejection((app) => rejectSubcommand(def, app, miss))
      }

      return match.preflight(rest, [...path, def.name])
    },
    async exec(argv, app, path): Promise<number> {
      const [head, ...rest] = argv
      const target = defaultTarget(head)

      if (target !== undefined) {
        return target.exec(argv, app, [...path, def.name])
      }

      if (head === undefined || HELP_FLAGS.has(head)) {
        printGroupHelp(def, app, path)

        return 0
      }

      const match = def.subcommands.find((sub) => sub.name === head)

      if (!match) {
        return rejectSubcommand(def, app, { path: [...path, def.name], attempted: head })
      }

      return match.exec(rest, app, [...path, def.name])
    },
  }
}

interface GroupRouting {
  readonly def: GroupDef
  readonly needs: Required<Needs>
  readonly defaultTarget: (head: string | undefined) => Command | Group | undefined
}

// A group's own needs merge with whichever subcommand the argv actually reaches; an unrecognized
// head resolves the group's needs so the run can get far enough to report the bad subcommand.
async function groupNeedsFor(
  routing: GroupRouting,
  argv: readonly string[]
): Promise<Required<Needs>> {
  const { def, needs, defaultTarget } = routing
  const [head, ...rest] = argv
  const target = defaultTarget(head)

  if (target !== undefined) {
    return mergeGroupNeeds(await target.needsFor(argv), needs)
  }

  if (head === undefined || HELP_FLAGS.has(head)) {
    return HELP_NEEDS
  }

  const match = def.subcommands.find((sub) => sub.name === head)

  if (match === undefined) {
    return resolveNeedsForArgs(needs, argv)
  }

  return mergeGroupNeeds(await match.needsFor(rest), needs)
}

function rejectSubcommand(def: GroupDef, output: CommandOutput, miss: Miss): number {
  if (def.name === '' && miss.attempted.startsWith('-')) {
    output.err(
      fail(t(output.config.locale.language, 'cliHelp.issueUnknownFlag', { token: miss.attempted }))
    )

    return usage(
      output,
      t(output.config.locale.language, 'cliHelp.runHelpAvailable', { command: BRAND.name })
    )
  }

  return unknownSubcommand(def, output, miss)
}

function unknownSubcommand(def: GroupDef, output: CommandOutput, miss: Miss): number {
  const { path, attempted } = miss
  const suggestion = closestName(
    attempted,
    def.subcommands.map((sub) => sub.name)
  )
  const locale = output.config.locale.language
  const attemptedPath = commandPath(path, attempted)

  output.err(style.error(t(locale, 'cliHelp.unknownCommand', { command: attemptedPath })))

  if (suggestion) {
    output.err(hint(t(locale, 'cliHelp.didYouMean', { command: suggestion })))
  }

  output.err(hint(t(locale, 'cliHelp.runHelpAvailable', { command: runnablePath(path, '') })))

  return 1
}

function commandPath(path: readonly string[], name: string): string {
  return [...path, name].filter(Boolean).join(' ')
}

// The program first: a message that tells the operator what to run must be pasteable as it stands.
function runnablePath(path: readonly string[], name: string): string {
  return commandPath([BRAND.name, ...path], name)
}

function hasHelp(argv: readonly string[]): boolean {
  return argv.some((arg) => HELP_FLAGS.has(arg))
}

function resolveNeedsForArgs(needs: Required<Needs>, argv: readonly string[]): Required<Needs> {
  return hasHelp(argv) ? HELP_NEEDS : needs
}

export interface CommandRejection {
  render(app: CliApp): number
}

function createCommandRejection(render: CommandRejection['render']): CommandRejection {
  return { render }
}
