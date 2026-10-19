#!/usr/bin/env bun
import type { Booted, MainOptions } from '@/app/types'
import type { CliApp, Command, EnvFileLoad, GlobalFlags, Group, Needs, Writer } from '@/cli/api'
import type { LoggerResource } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import { boot } from '@/app/boot'
import { bootRefusals } from '@/app/config-tree'
import { apiCommand } from '@/app/server/cli/api-command'
import { setupCommand } from '@/app/server/cli/setup-command'
import {
  admitCommand,
  BUILT_IN_COMMANDS,
  fail,
  formatArgIssue,
  formatTerminalError,
  getEnv,
  isVerbose,
  loadEnvFile,
  offerOnboard,
  parseGlobalFlags,
  preBootApp,
  preflightCommand,
  printError,
  readCommandCacheStubs,
  reportKeyFile,
  resolveContributedCliCommands,
  runCli,
  startUpdateNotice,
  stopDaemonIfRunning,
  writeCommandCache,
} from '@/cli/api'
import { resolveLoadDataDir } from '@/core/config/load'
import { resolveEnvFile } from '@/core/config/resolve'
import { formatErrForLog } from '@/core/security/credentials'

const CRASH_EXIT_CODE = 1
/** The reader closed the pipe (`| head`): the output it wanted was written, so nothing failed. */
const BROKEN_PIPE_CODE = 'EPIPE'
const EXIT_USAGE_DEFAULT = 2
const NEVER_ABORTING_SIGNAL = AbortSignal.any([])
/** The API's own commands; they need the app layer (the token path, the starter config), so they
 *  are not in the cli layer's BUILT_IN_COMMANDS. */
const SERVER_COMMANDS: readonly (Command | Group)[] = [apiCommand, setupCommand]

const stdio: { out: Writer; err: Writer; write: Writer } = {
  out: (line) => {
    process.stdout.write(`${line}\n`)
  },
  err: (line) => {
    process.stderr.write(`${line}\n`)
  },
  write: (chunk) => {
    process.stdout.write(chunk)
  },
}

interface FatalBoundary {
  bind(resource: LoggerResource): void
  dispose(): void
}

interface RunPreBootOptions {
  readonly app: CliApp
  readonly argv: readonly string[]
  readonly needs: Required<Needs>
  readonly commands: readonly (Command | Group)[]
}

interface RunCommandOptions {
  readonly flags: GlobalFlags
  readonly preBoot: CliApp
  readonly main: MainOptions | undefined
  readonly fatalBoundary: FatalBoundary
}

interface RunBootOptions {
  readonly flags: GlobalFlags
  readonly needs: Required<Needs>
  readonly extraCommands: readonly (Command | Group)[]
  readonly main: MainOptions | undefined
  readonly fatalBoundary: FatalBoundary
  /** The pre-boot read of `[locale]`, for a boot that fails before it has its own. */
  readonly locale: Locale
  readonly keyFile: CliApp['keyFile']
}

export async function main(argv: readonly string[], options?: MainOptions): Promise<number> {
  const fatalBoundary = installCrashHandlers()

  try {
    const flags = parseGlobalFlags(argv, getEnv())
    // Config resolution reads keys from `process.env`, so the key file loads first.
    const keyLoad = loadEnvFile(
      resolveEnvFile(
        resolveLoadDataDir(flags.dataDir === undefined ? {} : { dataDir: flags.dataDir })
      ),
      getEnv()
    )
    const preBoot = await createPreBootCliApp(flags, keyLoad)

    reportKeyFile({ config: preBoot.config, err: stdio.err }, keyLoad)

    const updateNotice = startUpdateNotice(preBoot, flags.argv[0])
    let exitCode: number | undefined

    try {
      exitCode = await runCommand({ flags, preBoot, main: options, fatalBoundary })

      return exitCode
    } finally {
      await updateNotice.finish(exitCode)
    }
  } catch (err: unknown) {
    return printError(err, { write: stdio.err, verbose: isVerbose() })
  } finally {
    fatalBoundary.dispose()
  }
}

async function runCommand(options: RunCommandOptions): Promise<number> {
  const { flags, preBoot, main: mainOptions, fatalBoundary } = options
  const extraCommands = [...SERVER_COMMANDS, ...(mainOptions?.extraCommands ?? [])]

  if (flags.issues.length > 0) {
    for (const issue of flags.issues) {
      preBoot.err(fail(formatArgIssue(preBoot.config.locale.language, issue)))
    }

    return EXIT_USAGE_DEFAULT
  }

  const cachedStubs = await readCommandCacheStubs(preBoot.config.paths.dataDir)
  const preBootCommands = [...extraCommands, ...cachedStubs]
  const preflight = await preflightCommand(flags.argv, preBootCommands)

  if (preflight.kind === 'rejected') {
    return preflight.rejection.render(preBoot)
  }

  const onboarded = await offerOnboard(preBoot, { argv: flags.argv, needs: preflight.needs })

  if (onboarded !== undefined) {
    return onboarded
  }

  // No-boot commands run with no DI or database, using only the resolved config probe.
  if (!preflight.needs.boot) {
    return await runPreBoot({
      app: preBoot,
      argv: flags.argv,
      needs: preflight.needs,
      commands: preBootCommands,
    })
  }

  const preparation = await prepareBoot(preBoot, preflight.needs)

  if (preparation !== undefined) {
    return preparation
  }

  return await runBoot({
    flags,
    needs: preflight.needs,
    extraCommands,
    main: mainOptions,
    fatalBoundary,
    locale: preBoot.config.locale.language,
    keyFile: preBoot.keyFile,
  })
}

async function runPreBoot(options: RunPreBootOptions): Promise<number> {
  const { app, argv, needs, commands } = options
  const blocked = await admitCommand(needs, app)

  return blocked ?? runCli(app, argv, commands)
}

async function prepareBoot(app: CliApp, needs: Required<Needs>): Promise<number | undefined> {
  if (needs.daemon === 'any' && needs.prepareDaemon === 'none') {
    return undefined
  }

  const blocked = await admitCommand(needs, app)

  if (blocked !== undefined) {
    return blocked
  }

  if (needs.prepareDaemon === 'stop') {
    const stopped = await stopDaemonIfRunning(app)

    return stopped === 0 ? undefined : stopped
  }

  return undefined
}

function pathFlags(flags: GlobalFlags): Pick<GlobalFlags, 'configPath' | 'dataDir' | 'logLevel'> {
  return {
    ...(flags.configPath === undefined ? {} : { configPath: flags.configPath }),
    ...(flags.dataDir === undefined ? {} : { dataDir: flags.dataDir }),
    ...(flags.logLevel === undefined ? {} : { logLevel: flags.logLevel }),
  }
}

function createPreBootCliApp(flags: GlobalFlags, keyLoad: EnvFileLoad): Promise<CliApp> {
  return preBootApp({
    ...stdio,
    keyFile: keyLoad.file,
    bootRefusals,
    assertComposes: () => composeOnce(flags),
    ...pathFlags(flags),
  })
}

/** The boot a command gets, with nothing hydrated or migrated, kept only long enough to see whether
 *  it composes. Boot warnings are left to the command that boots for real. */
async function composeOnce(flags: GlobalFlags): Promise<void> {
  const booted = await boot({
    mode: 'cli',
    startup: 'none',
    env: getEnv(),
    shutdownSignal: NEVER_ABORTING_SIGNAL,
    err: () => undefined,
    ...pathFlags(flags),
  })

  await booted.dispose()
}

async function runBoot(options: RunBootOptions): Promise<number> {
  const { flags, needs, extraCommands, main: mainOptions, fatalBoundary, locale } = options
  const isDaemon = needs.bootMode === 'daemon'
  const shutdown = isDaemon ? new AbortController() : undefined
  let booted: Booted | undefined

  try {
    booted = await boot({
      mode: needs.bootMode,
      bootScope: needs.bootScope,
      startup: needs.startup,
      env: getEnv(),
      configFile: needs.configFile,
      modelSource: needs.modelSource,
      shutdownSignal: shutdown?.signal ?? NEVER_ABORTING_SIGNAL,
      ...pathFlags(flags),
      err: stdio.err,
      ...(mainOptions?.features === undefined ? {} : { features: mainOptions.features }),
      ...(mainOptions?.bootGate === undefined ? {} : { bootGate: mainOptions.bootGate }),
      onLoggerResource: (resource) => fatalBoundary.bind(resource),
    })

    const cliApp: CliApp = {
      ...booted.app,
      ...stdio,
      keyFile: options.keyFile,
      ...(shutdown === undefined ? {} : { abortDaemon: () => shutdown.abort() }),
    }
    const contributed = resolveContributedCliCommands(cliApp, [
      ...BUILT_IN_COMMANDS,
      ...extraCommands,
    ])

    await refreshCommandCache(cliApp)

    return await runCli(cliApp, flags.argv, [...extraCommands, ...contributed])
  } catch (err: unknown) {
    // boot() never catches its own ConfigError (spec §13 Pillar C) — the entry prints it, once.
    return printError(err, { write: stdio.err, verbose: isVerbose(), locale })
  } finally {
    // Whatever the command did, the transports boot opened are ours to close.
    await booted?.dispose()
  }
}

/** Best-effort: the cache only feeds pre-boot help, so a write failure is logged and the command
 *  runs anyway. */
async function refreshCommandCache(app: CliApp): Promise<void> {
  try {
    await writeCommandCache(app.config.paths.dataDir, app.resolve('cliCommands'))
  } catch (err: unknown) {
    app.resolve('logger').warn('cli.command_cache_write_failed', { err: formatErrForLog(err) })
  }
}

// The process entry is the one place that owns "the whole thing died": past here there is no run,
// no command, and no caller left to report it.
function installCrashHandlers(): FatalBoundary {
  let resource: LoggerResource | undefined
  let terminating = false
  const die = (err: unknown): void => {
    if (terminating) {
      return
    }

    terminating = true

    if (isBrokenPipe(err)) {
      process.exit(0)
    }

    terminate(err, resource).catch(() => process.exit(CRASH_EXIT_CODE))
  }
  const onUncaught = (err: Error): void => die(err)
  const onRejected = (err: unknown): void => die(err)

  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onRejected)

  return {
    bind: (next) => {
      resource = next
    },
    dispose: () => {
      process.off('uncaughtException', onUncaught)
      process.off('unhandledRejection', onRejected)
    },
  }
}

function isBrokenPipe(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === BROKEN_PIPE_CODE
}

async function terminate(err: unknown, resource: LoggerResource | undefined): Promise<never> {
  if (resource?.isAvailable()) {
    resource.logger.fatal('process.crashed', { err: formatErrForLog(err) })
  }

  if (resource === undefined || !resource.isAvailable()) {
    writeFatalFallback(err)
  }

  await resource?.close()
  process.exit(CRASH_EXIT_CODE)
}

function writeFatalFallback(err: unknown): void {
  for (const line of formatTerminalError(err, { verbose: true })) {
    stdio.err(line)
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
