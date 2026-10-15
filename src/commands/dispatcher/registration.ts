import type { KeyValidator } from '@/commands/types'
import type { CommandMessageKey, SlashCommand, SlashInvocationPolicy } from '@/core/types/command'
import type { Exact } from '@/core/types/exact'
import { ValidationError } from '@/core/errors'
import { collectUnknownKeys, formatKeys, isPlainRecord } from '@/core/utils/collections'
import { isSlashCommandName } from '@/core/utils/text'

import { normalizeName } from './resolve'

const KEY_PREFIX_RE = /^slash\.[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/
const ALLOWED_COMMAND_KEYS: ReadonlySet<string> = new Set<string>([
  'name',
  'description',
  'messageKeys',
  'policy',
  'policyFor',
  'run',
])

interface CollectOptions {
  /** When absent, locale-key resolution is skipped (author-time validation needs no catalogs). */
  readonly keys?: KeyValidator
}

/** Every registration/validation problem for one command, in deterministic order.
 *
 *  An empty `messageKeys` is not one of them. The set gates `SlashResult` of kind `message`, so a
 *  command that renders its own text (`/reconcile`) has no key to declare, and a mismatch on a
 *  command that does emit one is caught where it happens - the dispatcher substitutes
 *  `slash.commandUnexpected` rather than trusting the declaration. */
export function collectSlashCommandIssues(
  command: SlashCommand,
  options?: CollectOptions
): readonly string[] {
  const issues: string[] = []
  const normalized = normalizeName(command.name)
  const keys = options?.keys

  if (!isSlashCommandName(command.name)) {
    issues.push(`invalid slash command name: ${command.name}`)
  }

  issues.push(...collectMessageKeyIssues(normalized, command.messageKeys, keys))
  issues.push(...collectPolicyIssues(command.name, command.policy))

  const progressKey = command.policy.execution?.progressKey

  if (progressKey !== undefined) {
    issues.push(...collectKeyIssues(`progress key on /${normalized}`, progressKey, keys))
  }

  if (command.description.kind === 'localized') {
    issues.push(...collectKeyIssues(`description on /${normalized}`, command.description.key, keys))
  }

  return issues
}

/** Shape and locale-resolution problems for one key, named by what declared it. */
function collectKeyIssues(
  owner: string,
  key: CommandMessageKey,
  keys?: KeyValidator
): readonly string[] {
  if (!KEY_PREFIX_RE.test(key)) {
    return [`invalid ${owner}: ${key}`]
  }

  if (keys !== undefined && !keys.resolvesEverywhere(key)) {
    return [`missing locale key for ${owner}: ${key}`]
  }

  return []
}

function collectMessageKeyIssues(
  normalized: string,
  messageKeys: readonly CommandMessageKey[],
  keys?: KeyValidator
): readonly string[] {
  const issues: string[] = []
  const seen = new Set<CommandMessageKey>()

  for (const key of messageKeys) {
    if (seen.has(key)) {
      issues.push(`duplicate message key on /${normalized}: ${key}`)
    }

    seen.add(key)
    issues.push(...collectKeyIssues(`message key on /${normalized}`, key, keys))
  }

  return issues
}

/** Throwing wrapper over the collector — used by the dispatcher and `createSlashCommand`. */
export function assertSlashCommandValid(command: SlashCommand, options?: CollectOptions): void {
  const issues = collectSlashCommandIssues(command, options)
  const first = issues[0]

  if (first !== undefined) {
    throw new ValidationError(first)
  }
}

/**
 * Runtime admission check on a resolved (possibly `policyFor`-derived) policy. One implementation
 * of the policy rule, shared by the registration collector and the dispatcher's resolve path.
 */
export function assertPolicyValid(name: string, policy: SlashInvocationPolicy): void {
  const issues = collectPolicyIssues(name, policy)
  const first = issues[0]

  if (first !== undefined) {
    throw new ValidationError(first)
  }
}

/**
 * Author-time factory. Validates the name, unknown keys, and structural shape synchronously; the
 * `messageKeys` and locale-key conventions are composition-time checks surfaced through the
 * aggregated boot report. Returns the command verbatim.
 */
export function createSlashCommand(def: Exact<SlashCommand, SlashCommand>): SlashCommand {
  if (!isPlainRecord(def)) {
    throw new ValidationError('createSlashCommand requires a command object')
  }

  if (!isPlainRecord(def.policy) || typeof def.name !== 'string' || typeof def.run !== 'function') {
    throw new ValidationError('createSlashCommand: name, policy, and run are required')
  }

  const unknown = collectUnknownKeys(def, ALLOWED_COMMAND_KEYS)

  if (unknown.length > 0) {
    throw new ValidationError(`createSlashCommand: unknown field(s) ${formatKeys(unknown)}`)
  }

  assertSlashCommandValid(def)

  return def
}

function collectPolicyIssues(name: string, policy: SlashInvocationPolicy): readonly string[] {
  const normalized = normalizeName(name)
  const issues: string[] = []

  if (!Array.isArray(policy.surfaces) || policy.surfaces.length === 0) {
    issues.push(`/${normalized} declares no surfaces`)
  }

  if (policy.action === 'read' && policy.cooldownMs !== undefined) {
    issues.push(`read command /${normalized} may not declare cooldownMs`)
  }

  return issues
}
