import { createHash } from 'node:crypto'

import type { SessionId } from '@/core/ids'
import type { ApprovalManager } from '@/engine/hooks/approval'
import type { PreparedToolCall, ToolGateResult } from '@/engine/types/run'
import { canonicalJson } from '@/core/utils/hash'
import { MAX_TRACKED_APPROVAL_SESSIONS } from '@/engine/constants'

export function createApprovalManager(): ApprovalManager {
  const sessionAllowlist = new Map<SessionId, Set<string>>()
  const pending = new Map<string, Promise<ToolGateResult>>()

  return {
    isApproved(sessionId, key): boolean {
      return sessionAllowlist.get(sessionId)?.has(key) ?? false
    },

    recordSession(sessionId, key): void {
      const allowed = sessionAllowlist.get(sessionId) ?? new Set<string>()

      allowed.add(key)
      // Delete before set: `Map.set` keeps an existing key's original position, so eviction would
      // drop a live session that has been remembering approvals all along.
      sessionAllowlist.delete(sessionId)
      sessionAllowlist.set(sessionId, allowed)
      evictOldest(sessionAllowlist, MAX_TRACKED_APPROVAL_SESSIONS)
    },

    clearSession(sessionId): void {
      sessionAllowlist.delete(sessionId)
    },

    // Identical calls in flight at the same moment share one prompt. A repeat after one settles
    // asks again by design: a spent "once" allow must not cover a call the operator never saw.
    dedupApproval(key, decide): Promise<ToolGateResult> {
      const existing = pending.get(key)

      if (existing !== undefined) {
        return existing
      }

      const decision = decide().finally(() => pending.delete(key))

      pending.set(key, decision)

      return decision
    },
  }
}

// Map iteration is insertion-order, so the first key is the oldest.
function evictOldest<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value

    if (oldest === undefined) {
      return
    }

    map.delete(oldest)
  }
}

// A remembered approval covers the exact call the operator saw, never the tool by name: the shell
// tool is unsandboxed and an external tool's server decides what its arguments do. Shell keys on a
// digest of the command as given (`/usr/bin/ls` and `./ls` differ) and its unscrubbed argv, an
// external tool on a digest of its whole input; a different call re-prompts. Digesting keeps a
// secret argument out of memory in clear and lets `["a b"]` and `["a", "b"]` differ. Only this key
// carries the full call - the prompt stays short.
export function approvalKeyFor(call: PreparedToolCall): string {
  if (call.tool.capability === 'shell') {
    const command = commandOf(call.input)

    return command === undefined ? call.name : `${call.name}:${digest(command)}`
  }

  return call.tool.isExternal === true ? `${call.name}:${digest(call.input)}` : call.name
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function commandOf(input: unknown): readonly string[] | undefined {
  if (typeof input !== 'object' || input === null || !('command' in input)) {
    return undefined
  }

  const command = input.command

  if (typeof command !== 'string') {
    return undefined
  }

  return [command, ...argsOf(input)]
}

function argsOf(input: object): readonly string[] {
  if (!('args' in input && Array.isArray(input.args))) {
    return []
  }

  return input.args.filter((arg): arg is string => typeof arg === 'string')
}
