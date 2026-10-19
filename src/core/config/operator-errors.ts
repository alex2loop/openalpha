import type { z } from 'zod'

import type { OperatorMessage } from '@/core/types/operator-message'
import { BRAND } from '@/core/brand'
import { knownKeysAt } from '@/core/config/schema-keys'
import { ConfigError } from '@/core/errors'
import { closestName } from '@/core/utils/text'

const ROOT_FIELD = '(root)'
const MAX_REPORTED_PROBLEMS = 8
const MISSING_ENV_CAUSE_DEPTH = 4
const ISSUE_DETAILS: ReadonlySet<string> = new Set([
  'divisor',
  'format',
  'maximum',
  'minimum',
  'values',
])
// The words an operator editing TOML knows a value by; a type outside it reads as the generic line.
const TOML_VALUE_KINDS: Readonly<Record<string, string>> = Object.freeze({
  array: 'list',
  boolean: 'boolean',
  int: 'integer',
  number: 'number',
  object: 'table',
  record: 'table',
  string: 'string',
  tuple: 'list',
})

type ConfigPath = readonly (string | number)[]

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** What a variable name can be made of: the one pattern MCP placeholders, onboard and the key file
 *  all hold a name to. */
export function isEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name)
}

/** The command that stores `env` where every later command finds it, the same on every platform.
 *  A brand-prefixed name steers how the program runs and never lives in the key file, so it is set
 *  in the shell instead. */
export function setEnvCommand(env: string): string {
  if (env.startsWith(BRAND.envPrefix)) {
    return process.platform === 'win32'
      ? `$env:${env}="..."; setx ${env} "..."`
      : `export ${env}=...`
  }

  return `${BRAND.name} key set ${env}`
}

interface OperatorConfigErrorDetails {
  readonly path?: ConfigPath
  readonly cause?: unknown
}

/** A setup failure the operator can fix, worded for them in their own language. `message` stays
 *  the English diagnostic the log and `--verbose` print. */
export class OperatorConfigError extends ConfigError {
  override readonly operator: OperatorMessage

  constructor(
    message: string,
    operator: OperatorMessage,
    details: OperatorConfigErrorDetails = {}
  ) {
    super(message, details.cause, details.path)
    this.operator = operator
  }
}

/** What a key switches off, as a catalog key under `errors.keyEffect`: named in the operator's
 *  sentence, so the reader learns what waits for it and not only which variable is unset. */
export type KeyEffect = 'model' | 'search'

interface MissingEnvLocation {
  readonly path: ConfigPath
  /** What the key switches off. Absent for a setting the whole owner depends on. */
  readonly effect?: KeyEffect
}

export class MissingEnvError extends OperatorConfigError {
  readonly env: string

  constructor(env: string, owner: string, location: MissingEnvLocation) {
    const { path, effect } = location
    const command = setEnvCommand(env)

    super(
      `${owner}: env var "${env}" is not set; set it with \`${command}\``,
      effect === undefined
        ? { key: 'errors.configEnvMissing', params: { env, owner, command } }
        : {
            key: 'errors.configEnvMissingEffect',
            params: { env, command, effect: { key: `errors.keyEffect.${effect}` } },
          },
      { path }
    )
    this.env = env
  }
}

/** The unset key behind a failure, found through the causes a wrapper adds: a typed marker for
 *  callers that act on a missing key (skip, warn once) and must not match on text. */
export function missingEnvOf(err: unknown, depth = 0): MissingEnvError | undefined {
  if (!(err instanceof Error) || depth >= MISSING_ENV_CAUSE_DEPTH) {
    return undefined
  }

  return err instanceof MissingEnvError ? err : missingEnvOf(err.cause, depth + 1)
}

interface ConfigProblem {
  readonly path: ConfigPath
  readonly issue: IssueParam
}

interface InvalidConfigDetails {
  readonly cause?: unknown
  readonly unchecked?: Readonly<Record<string, unknown>>
}

/** A schema refusal listing every issue, the first `MAX_REPORTED_PROBLEMS` by name and the rest as a
 *  count. It keeps its problems so refusals from sections validated apart (core's, then a module's)
 *  read as one list. `unchecked` holds the sections the refusing pass never reached: core refuses
 *  before any module reads its own. */
export class InvalidConfigError extends OperatorConfigError {
  readonly problems: readonly ConfigProblem[]
  readonly unchecked?: Readonly<Record<string, unknown>>

  constructor(message: string, problems: readonly ConfigProblem[], details: InvalidConfigDetails) {
    super(
      message,
      { key: 'errors.configInvalid', params: { problems: problemLines(problems) } },
      { path: problems[0]?.path ?? [], cause: details.cause }
    )
    this.problems = problems

    if (details.unchecked !== undefined) {
      this.unchecked = details.unchecked
    }
  }
}

interface InvalidConfigOptions {
  /** Prefixes the path for a section a module validates itself. */
  readonly section?: string
  readonly unchecked?: Readonly<Record<string, unknown>>
  /** Where every accepted key is listed; the sample config unless the file is another one. */
  readonly sample?: string
}

/** `schema` is the refused section's, where a misspelt key looks for the name it was meant to be. */
export function toInvalidConfigError(
  err: z.ZodError,
  schema: z.core.$ZodType,
  options: InvalidConfigOptions = {}
): InvalidConfigError {
  const prefix = options.section === undefined ? [] : [options.section]

  return new InvalidConfigError(
    `invalid config:\n  ${formatIssues(err, prefix)}`,
    toProblems(err, schema, { prefix, sample: options.sample ?? BRAND.sampleConfigUrl }),
    { cause: err, ...(options.unchecked === undefined ? {} : { unchecked: options.unchecked }) }
  )
}

/** One refusal listing both sets of problems, the first's ahead. */
export function combineInvalidConfigErrors(
  first: InvalidConfigError,
  second: InvalidConfigError
): InvalidConfigError {
  return new InvalidConfigError(
    `${first.message}\n${second.message}`,
    [...first.problems, ...second.problems],
    { cause: first.cause }
  )
}

// An unknown key is one problem per key, so each gets its own did-you-mean.
interface ProblemScope {
  readonly prefix: readonly string[]
  readonly sample: string
}

function toProblems(
  err: z.ZodError,
  schema: z.core.$ZodType,
  scope: ProblemScope
): readonly ConfigProblem[] {
  return err.issues.flatMap((issue) => {
    const table = issuePath(issue)
    const path = [...scope.prefix, ...table]

    if (issue.code !== 'unrecognized_keys') {
      return [{ path, issue: issueParam(issue, scope.sample) }]
    }

    const known = knownKeysAt(schema, table)

    return issue.keys.map((key) => ({
      path: [...path, key],
      issue: unknownKeyParam({ key, known, sample: scope.sample }, issue.message),
    }))
  })
}

interface UnknownKey {
  readonly key: string
  readonly known: readonly string[]
  readonly sample: string
}

function unknownKeyParam(unknown: UnknownKey, fallback: string): IssueParam {
  const near = closestName(unknown.key, unknown.known)

  return {
    key: `errors.configIssue.unrecognized_keys${near === undefined ? '' : '_near'}`,
    params: { sample: unknown.sample, ...(near === undefined ? {} : { near }) },
    fallback,
  }
}

function problemLines(problems: readonly ConfigProblem[]): readonly OperatorMessage[] {
  const shown = problems.slice(0, MAX_REPORTED_PROBLEMS).map((problem) => ({
    key: 'errors.configProblem',
    params: { field: fieldText(problem.path), issue: problem.issue },
  }))
  const hidden = problems.length - shown.length

  return hidden > 0
    ? [...shown, { key: 'errors.configProblemsMore', params: { count: hidden } }]
    : shown
}

interface IssueParam {
  readonly key: string
  readonly params: Readonly<Record<string, string | number>>
  readonly fallback: string
}

function issueParam(issue: z.core.$ZodIssue, sample: string): IssueParam {
  return {
    key: `errors.configIssue.${issueKind(issue)}`,
    params: { sample, ...issueParams(issue) },
    fallback: issue.message,
  }
}

function issueKind(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_format' && issue.format === 'regex') {
    return 'invalid_pattern'
  }

  if (issue.code === 'invalid_type') {
    const kind = TOML_VALUE_KINDS[issue.expected]

    return kind === undefined ? issue.code : `${issue.code}_${kind}`
  }

  return 'inclusive' in issue && issue.inclusive === false ? `${issue.code}_exclusive` : issue.code
}

function issueParams(issue: z.core.$ZodIssue): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(issue).flatMap(([name, value]) =>
      ISSUE_DETAILS.has(name)
        ? [[name, Array.isArray(value) ? value.join(', ') : String(value)]]
        : []
    )
  )
}

function formatIssues(err: z.ZodError, prefix: readonly string[]): string {
  return err.issues
    .map((issue) => `${fieldText([...prefix, ...issuePath(issue)])}: ${issue.message}`)
    .join('\n  ')
}

function issuePath(issue: z.core.$ZodIssue | undefined): (string | number)[] {
  return (issue?.path ?? []).filter(
    (segment): segment is string | number => typeof segment !== 'symbol'
  )
}

function fieldText(path: ConfigPath): string {
  return path.length > 0 ? path.join('.') : ROOT_FIELD
}
