import type { LogLevel } from '@/core/config/resolve'
import { type ArgIssue, END_OF_OPTIONS } from '@/cli/parsing/args'
import { BRAND } from '@/core/brand'

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal']
const VALUE_FLAG_NAMES = ['--config', '--data-dir', '--log-level'] as const
const ENV_LOG_LEVEL = BRAND.controlEnv.logLevel

export interface GlobalFlags {
  /** argv with the global flags stripped out, ready for the command tree. */
  readonly argv: readonly string[]
  readonly quiet: boolean
  readonly verbose: boolean
  readonly noColor: boolean
  readonly configPath?: string
  readonly dataDir?: string
  readonly logLevel?: LogLevel
  /** Global flags the parser rejected; the entry rejects before boot. */
  readonly issues: readonly ArgIssue[]
}

interface Accumulator {
  argv: string[]
  quiet: boolean
  verbose: boolean
  noColor: boolean
  configPath?: string
  dataDir?: string
  logLevel?: LogLevel
  issues: ArgIssue[]
}

export function parseGlobalFlags(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): GlobalFlags {
  const acc: Accumulator = { argv: [], quiet: false, verbose: false, noColor: false, issues: [] }
  readEnvLogLevel(acc, env)
  let index = 0

  while (index < argv.length) {
    const token = argv[index]

    if (token === undefined) {
      break
    }

    // Everything from `--` on belongs to the command, flags included.
    if (token === END_OF_OPTIONS) {
      acc.argv.push(...argv.slice(index))

      break
    }

    index += take(acc, token, argv[index + 1])
  }

  if (acc.quiet && acc.verbose) {
    acc.issues.push({ token: '--quiet/--verbose', code: 'conflicting_flags' })
  }

  return acc
}

function readEnvLogLevel(
  acc: Accumulator,
  env: Readonly<Record<string, string | undefined>>
): void {
  const value = env[ENV_LOG_LEVEL]

  if (value === undefined) {
    return
  }

  if (isLogLevel(value)) {
    acc.logLevel = value

    return
  }

  acc.issues.push({ token: ENV_LOG_LEVEL, code: 'invalid_choice', value })
}

// Returns how many argv entries were consumed.
function take(acc: Accumulator, token: string, next: string | undefined): number {
  if (token === '--quiet' || token === '-q') {
    acc.quiet = true

    return 1
  }

  if (token === '--verbose') {
    acc.verbose = true

    return 1
  }

  if (token === '--no-color') {
    acc.noColor = true

    return 1
  }

  const valued = valueFlag(token, next)

  if (valued !== null) {
    applyValue(acc, valued.name, valued.value)

    return valued.consumed
  }

  // `--config` and `--config=` are the same mistake; neither may reach the command tree as a
  // positional, where it would surface as "unknown command".
  if (isValueFlagName(token) || VALUE_FLAG_NAMES.some((name) => token === `${name}=`)) {
    acc.issues.push({ token, code: 'missing_value' })

    return 1
  }

  acc.argv.push(token)

  return 1
}

interface ValuedFlag {
  readonly name: string
  readonly value: string
  readonly consumed: number
}

function valueFlag(token: string, next: string | undefined): ValuedFlag | null {
  for (const name of VALUE_FLAG_NAMES) {
    if (token === name && next !== undefined && !next.startsWith('-')) {
      return { name, value: next, consumed: 2 }
    }

    if (token.startsWith(`${name}=`) && token.length > name.length + 1) {
      return { name, value: token.slice(name.length + 1), consumed: 1 }
    }
  }

  return null
}

function isValueFlagName(value: string): value is (typeof VALUE_FLAG_NAMES)[number] {
  return VALUE_FLAG_NAMES.some((name) => name === value)
}

function applyValue(acc: Accumulator, name: string, value: string): void {
  if (name === '--config') {
    acc.configPath = value

    return
  }

  if (name === '--data-dir') {
    acc.dataDir = value

    return
  }

  if (name === '--log-level') {
    if (isLogLevel(value)) {
      acc.logLevel = value

      return
    }

    acc.issues.push({ token: '--log-level', code: 'invalid_choice', value })
  }
}

function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.some((level) => level === value)
}
