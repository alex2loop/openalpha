import type { z } from 'zod'

import type { OperatorMessage } from '@/core/types/operator-message'
import { ConfigError } from '@/core/errors'

const ROOT_FIELD = '(root)'
const ISSUE_DETAILS: ReadonlySet<string> = new Set([
  'divisor',
  'expected',
  'format',
  'keys',
  'maximum',
  'minimum',
  'values',
])

type ConfigPath = readonly (string | number)[]

/** The shell line that sets `env` in the operator's own shell: PowerShell has no `export`, and
 *  `setx` alone reaches only terminals opened after it. */
export function setEnvCommand(env: string): string {
  return process.platform === 'win32' ? `$env:${env}="..."; setx ${env} "..."` : `export ${env}=...`
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

export class MissingEnvError extends OperatorConfigError {
  constructor(env: string, owner: string, path: ConfigPath) {
    super(
      `${owner}: env var "${env}" is not set`,
      { key: 'errors.configEnvMissing', params: { env, owner, command: setEnvCommand(env) } },
      { path }
    )
  }
}

/** A schema refusal, worded from its first issue. `section` prefixes the path for a section a module
 *  validates itself; an unknown key is added to the error's path, not to the field it names. */
export function toInvalidConfigError(err: z.ZodError, section?: string): OperatorConfigError {
  const [first] = err.issues
  const prefix = section === undefined ? [] : [section]
  const field = [...prefix, ...issuePath(first)]
  const unknownKey = first?.code === 'unrecognized_keys' ? first.keys.slice(0, 1) : []

  return new OperatorConfigError(
    `invalid config:\n  ${formatIssues(err, prefix)}`,
    {
      key: 'errors.configInvalid',
      params: { field: fieldText(field), issue: first === undefined ? '' : issueParam(first) },
    },
    { path: [...field, ...unknownKey], cause: err }
  )
}

interface IssueParam {
  readonly key: string
  readonly params: Readonly<Record<string, string | number>>
  readonly fallback: string
}

function issueParam(issue: z.core.$ZodIssue): IssueParam {
  return {
    key: `errors.configIssue.${issueKind(issue)}`,
    params: issueParams(issue),
    fallback: issue.message,
  }
}

function issueKind(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_format' && issue.format === 'regex') {
    return 'invalid_pattern'
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
