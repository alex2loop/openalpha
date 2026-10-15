import type {
  CommandTranscript,
  KeyValidator,
  ResolvedSlashCommand,
  SlashDispatcher,
} from '@/commands/types'
import type { Logger } from '@/core/logging/logger'
import type {
  CommandMessageKey,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import { isAbortError, RunHalted, ValidationError } from '@/core/errors'
import { withCorrelation } from '@/core/logging/correlation'

import { assertPolicyValid, assertSlashCommandValid } from './registration'
import { IDEMPOTENCY_TTL_MS, RATE_WINDOW_MS, sweepRegistries } from './registries'
import {
  dispatchLine,
  isCommandVisible,
  isRoleAllowed,
  normalizeName,
  parseCommand,
  suggestCommandName,
} from './resolve'
import { toSlashResult } from './result'
import { appendExchange } from './transcript'

const DEFAULT_RATE_PER_MINUTE = 20
const KEY_SEPARATOR_RE = /[\\:]/g

interface SlashDispatcherDeps {
  readonly keys: KeyValidator
  readonly logger: Logger
  readonly transcript: CommandTranscript
  readonly ratePerMinute?: number
}

export function createSlashDispatcher(deps: SlashDispatcherDeps): SlashDispatcher {
  const commands = new Map<string, SlashCommand>()
  const state: DispatchState = {
    cooldowns: new Map(),
    idempotency: new Map(),
    calls: new Map(),
    pendingKeys: new Set(),
    ratePerMinute: deps.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE,
    logger: deps.logger,
    transcript: deps.transcript,
  }

  return {
    register: (command) => registerCommand(commands, command, deps.keys),
    all: (surface, role) =>
      [...commands.values()].filter((command) => isCommandVisible(command.policy, surface, role)),
    resolve: (line): ResolvedSlashCommand | null => {
      const parsed = parseCommand(line)
      return parsed === null ? null : resolveParsed(parsed.raw, parsed.args, commands)
    },
    dispatchResolved: (resolved, context) => dispatchResolved({ ...state, resolved, context }),
    dispatch: (line, context) =>
      dispatchLine({
        line,
        resolve: (raw, args) => resolveParsed(raw, args, commands),
        suggest: (raw) =>
          suggestCommandName({
            commands,
            target: normalizeName(raw),
            surface: context.surface,
            role: context.role,
          }),
        runResolved: (resolved) => dispatchResolved({ ...state, resolved, context }),
      }),
  }
}

function registerCommand(
  commands: Map<string, SlashCommand>,
  command: SlashCommand,
  keys: KeyValidator
): void {
  assertSlashCommandValid(command, { keys })
  const normalized = normalizeName(command.name)

  if (commands.has(normalized)) {
    throw new ValidationError(`duplicate slash command: ${normalized}`)
  }

  commands.set(normalized, { ...command, name: normalized })
}

function resolveParsed(
  raw: string,
  args: readonly string[],
  commands: Map<string, SlashCommand>
): ResolvedSlashCommand | null {
  const command = commands.get(normalizeName(raw))

  if (command === undefined) {
    return null
  }

  const policy = command.policyFor?.(args) ?? command.policy
  assertPolicyValid(command.name, policy)
  return { command, args, policy }
}

interface DispatchState {
  readonly cooldowns: Map<string, number>
  readonly idempotency: Map<string, number>
  readonly calls: Map<string, readonly number[]>
  readonly pendingKeys: Set<string>
  readonly ratePerMinute: number
  readonly logger: Logger
  readonly transcript: CommandTranscript
}

interface AdmissionOptions extends DispatchState {
  readonly resolved: ResolvedSlashCommand
  readonly context: SlashContext
}

interface AdmissionLease {
  commit(): void
  release(): void
}

type AdmissionResult =
  | { readonly kind: 'admitted'; readonly lease: AdmissionLease }
  | { readonly kind: 'rejected'; readonly result: SlashResult }

/** A channel stamps one id per inbound message, so a command and every engine turn it starts group
 *  together; the REPL has only the session, which is the honest granularity there. */
function dispatchResolved(options: AdmissionOptions): Promise<SlashResult> {
  const id = options.context.correlationId ?? options.context.sessionId

  return withCorrelation(id, () => dispatchAdmitted(options))
}

async function dispatchAdmitted(options: AdmissionOptions): Promise<SlashResult> {
  const admission = admit(options)

  if (admission.kind === 'rejected') {
    return admission.result
  }

  const lease = admission.lease
  let committed = false
  try {
    const raw = await options.resolved.command.run({
      ...options.context,
      args: options.resolved.args,
    })
    const result = toSlashResult(options.resolved.command, raw)
    lease.commit()
    committed = true

    await appendExchange({
      transcript: options.transcript,
      logger: options.logger,
      sessionId: options.context.sessionId,
      name: options.resolved.command.name,
      args: options.resolved.args,
      policy: options.resolved.policy,
      result,
    })

    return result
  } catch (err: unknown) {
    if (isCancellation(err)) {
      return { kind: 'handled' }
    }
    throw err
  } finally {
    if (!committed) {
      lease.release()
    }
  }
}

// Both cancellation shapes a command can raise: a native fetch/stream abort, and the runtime's
// own typed halt from `abortError`.
function isCancellation(err: unknown): boolean {
  if (err instanceof RunHalted) {
    return err.code === 'abort'
  }

  return isAbortError(err)
}

function rejectMessage(key: CommandMessageKey): AdmissionResult {
  return {
    kind: 'rejected',
    result: { kind: 'message', messages: [{ key }] },
  }
}

function rejectHandled(): AdmissionResult {
  return { kind: 'rejected', result: { kind: 'handled' } }
}

function admit(options: AdmissionOptions): AdmissionResult {
  const { resolved, context, cooldowns, idempotency, calls, pendingKeys, ratePerMinute } = options
  const { policy, command } = resolved

  if (!policy.surfaces.includes(context.surface)) {
    return rejectMessage('slash.commandUnexpected')
  }

  if (!isRoleAllowed(policy.role, context.role)) {
    return rejectMessage('slash.commandForbidden')
  }

  const now = Date.now()
  sweepRegistries({ cooldowns, idempotency, calls, now })

  const keys: string[] = []
  // A platform-local user id is unique only within its channel, so every gate keys off the whole
  // identity tuple: Telegram 42 and Zalo 42 are different people.
  const identity = [context.surface, context.channel, context.userId]
  const gate = [...identity, context.chatId, command.name]
  const gateKey = encodeKey(gate)
  let cooldownKey: string | undefined
  let cooldownMs: number | undefined

  if (policy.cooldownMs !== undefined) {
    cooldownMs = policy.cooldownMs
    cooldownKey = gateKey
    if (isCooldownActive({ cooldowns, pendingKeys, key: cooldownKey, now })) {
      return rejectMessage('slash.rateLimited')
    }
    keys.push(cooldownKey)
  }

  const rateKey = encodeKey(identity)

  // Before the idempotency stamp below: a key stamped first would answer every redelivery `handled`
  // for the whole TTL without ever running the command.
  if (isRateExceeded({ calls, key: rateKey, now, limit: ratePerMinute })) {
    return rejectMessage('slash.rateLimited')
  }

  if (policy.idempotencyKey !== undefined) {
    const idempotencyKey = encodeKey([...gate, policy.idempotencyKey(context)])

    if (isIdempotencyActive({ idempotency, pendingKeys, key: idempotencyKey, now })) {
      return rejectHandled()
    }

    keys.push(idempotencyKey)
    // Stamped on admission, not on completion: a command that side-effects and then throws must
    // not run again when the inbox redelivers the message it came from.
    idempotency.set(idempotencyKey, now)
  }

  // Charged here, not on commit, and deliberately not fenced by `pendingKeys`: the budget is per
  // identity per minute, so concurrent commands each take a slot. Treating it as single-flight
  // would cap the user at one command at a time — /cancel could never reach a run still going.
  recordCall(calls, rateKey, now)

  for (const key of keys) {
    pendingKeys.add(key)
  }

  return {
    kind: 'admitted',
    lease: createAdmissionLease({ keys, cooldowns, pendingKeys, cooldownKey, cooldownMs, now }),
  }
}

function recordCall(calls: Map<string, readonly number[]>, key: string, now: number): void {
  calls.set(key, [...activeCalls(calls, key, now), now])
}

function activeCalls(
  calls: Map<string, readonly number[]>,
  key: string,
  now: number
): readonly number[] {
  return (calls.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
}

// Escapes the separator so no part can forge another identity's key.
function encodeKey(parts: readonly string[]): string {
  return parts.map((part) => part.replace(KEY_SEPARATOR_RE, '\\$&')).join(':')
}

interface AdmissionLeaseOptions {
  readonly keys: readonly string[]
  readonly cooldowns: Map<string, number>
  readonly pendingKeys: Set<string>
  readonly cooldownKey: string | undefined
  readonly cooldownMs: number | undefined
  readonly now: number
}

function createAdmissionLease(options: AdmissionLeaseOptions): AdmissionLease {
  const clearPending = (): void => {
    for (const key of options.keys) {
      options.pendingKeys.delete(key)
    }
  }

  return {
    commit() {
      if (options.cooldownKey !== undefined && options.cooldownMs !== undefined) {
        options.cooldowns.set(options.cooldownKey, options.now + options.cooldownMs)
      }

      clearPending()
    },
    release: clearPending,
  }
}

function isCooldownActive(options: {
  readonly cooldowns: Map<string, number>
  readonly pendingKeys: Set<string>
  readonly key: string
  readonly now: number
}): boolean {
  return (
    options.pendingKeys.has(options.key) || (options.cooldowns.get(options.key) ?? 0) > options.now
  )
}

function isIdempotencyActive(options: {
  readonly idempotency: Map<string, number>
  readonly pendingKeys: Set<string>
  readonly key: string
  readonly now: number
}): boolean {
  return (
    options.pendingKeys.has(options.key) ||
    (options.idempotency.get(options.key) ?? 0) > options.now - IDEMPOTENCY_TTL_MS
  )
}

function isRateExceeded(options: {
  readonly calls: Map<string, readonly number[]>
  readonly key: string
  readonly now: number
  readonly limit: number
}): boolean {
  return activeCalls(options.calls, options.key, options.now).length >= options.limit
}
