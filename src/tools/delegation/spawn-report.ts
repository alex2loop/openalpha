import type { ToolInvocationContext } from '@/core/tool'
import type { AgentProfile, RunResult } from '@/engine/api'
import type {
  ChildRunSettlement,
  ProgressReporter,
  ProgressTag,
} from '@/tools/delegation/child-run'
import { MS_PER_MINUTE } from '@/core/utils/time'

const SPAWN_REASON_KEYS = {
  timeout: 'tools.spawn.reason.timeout',
  turns: 'tools.spawn.reason.turns',
  budget: 'tools.spawn.reason.budget',
  error: 'tools.spawn.reason.error',
} as const satisfies Record<SpawnReason, string>

type SpawnReason = 'timeout' | 'turns' | 'budget' | 'error'

export interface SpawnResult {
  readonly role: string
  readonly status: 'done' | 'partial' | 'failed'
  readonly reason?: SpawnReason
  readonly text: string
}

export interface SpawnProgress {
  /** The one line a channel or the terminal shows for the whole group. */
  line(): void
  /** Tool, model and ending lines for one child: feed only, never printed by a channel. */
  report: ProgressReporter
  tag(role: string): ProgressTag
  finished(result: SpawnResult): void
}

export function createSpawnProgress(
  ctx: ToolInvocationContext,
  children: readonly { readonly profile: AgentProfile }[]
): SpawnProgress {
  const minutes = Math.max(1, Math.round((children[0]?.profile.maxDurationMs ?? 0) / MS_PER_MINUTE))
  const turns = children[0]?.profile.maxTurns ?? 0
  const base: ProgressTag = { kind: 'spawn', parentRunId: ctx.runId }
  let done = 0
  const line = (): void =>
    ctx.reportProgress?.({
      key: 'progress.spawnLine',
      params: { agent: ctx.agentId, count: children.length, done, ...base },
      mode: 'transient',
    })
  const report: ProgressReporter = (message) =>
    ctx.bus.emit('run_progress', {
      runId: ctx.runId,
      agentId: ctx.agentId,
      channel: ctx.channel,
      message,
    })

  return {
    line,
    report,
    tag: (role) => ({ ...base, role }),
    finished: (result) => {
      done += 1

      if (result.reason !== undefined) {
        report({
          key: SPAWN_REASON_KEYS[result.reason],
          params: { minutes, turns, ...base, role: result.role },
          mode: 'transient',
        })
      }

      line()
    },
  }
}

export function toSpawnResult(role: string, settlement: ChildRunSettlement): SpawnResult {
  const { text } = settlement.result

  switch (settlement.kind) {
    case 'completed':
      return { role, status: 'done', text }
    case 'budget_exhausted':
      return { role, status: toPartialStatus(text), reason: 'budget', text }
    case 'approval_timeout':
      return { role, status: toPartialStatus(text), reason: 'error', text }
    case 'failed':
      return toFailedResult(role, settlement.result)
  }
}

// Stopped together with its parent: nothing went wrong in the child, so no reason is given.
function toFailedResult(role: string, result: RunResult): SpawnResult {
  const { text } = result

  switch (result.reason) {
    case 'aborted':
      return { role, status: 'failed', text }
    case 'timeout':
      return { role, status: toPartialStatus(text), reason: 'timeout', text }
    case 'turn_limit':
      return { role, status: toPartialStatus(text), reason: 'turns', text }
    default:
      return { role, status: toPartialStatus(text), reason: 'error', text }
  }
}

function toPartialStatus(text: string): 'partial' | 'failed' {
  return text === '' ? 'failed' : 'partial'
}
