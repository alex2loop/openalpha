import type { ClientModelRequest } from '@/ai/api'
import type { ToolResult } from '@/core/tool'
import type { McpJobCall, McpJobRefusal, McpJobReply } from '@/engine/mcp/jobs/types'

type Timer = ReturnType<typeof setTimeout>

/** How a waiting call wants its reply: every request whole, and whether it takes the result or
 *  only hears that the run finished. */
export interface ReplyShape {
  readonly inline: boolean
  readonly collectsResult: boolean
}

interface Waiter extends ReplyShape {
  readonly progress?: McpJobCall['progress']
  settle(reply: McpJobReply): void
}

export interface McpJob {
  readonly id: string
  readonly controller: AbortController
  /** `performance.now()` each pending request was first read. */
  readonly viewedAt: Map<string, number>
  result?: ToolResult
  waiter?: Waiter | undefined
  closed: boolean
  idleTimer?: Timer | undefined
  batchTimer?: Timer | undefined
  waitTimer?: Timer | undefined
  retentionTimer?: Timer | undefined
}

export function clearJobTimers(job: McpJob): void {
  clearWaitTimers(job)
  clearTimeout(job.idleTimer)
  clearTimeout(job.retentionTimer)
  job.idleTimer = undefined
  job.retentionTimer = undefined
}

export function clearWaitTimers(job: McpJob): void {
  clearTimeout(job.batchTimer)
  clearTimeout(job.waitTimer)
  job.batchTimer = undefined
  job.waitTimer = undefined
}

export function requestsReply(
  continuation: string,
  pending: readonly ClientModelRequest[],
  inline: boolean
): McpJobReply {
  return { kind: 'requests', continuation, requests: pending, inline }
}

export function finishedReply(continuation: string): McpJobReply {
  return { kind: 'finished', continuation }
}

export function workingReply(continuation: string): McpJobReply {
  return { kind: 'working', continuation }
}

export function refused(refusal: McpJobRefusal): McpJobReply {
  return { kind: 'refused', refusal }
}

export function startTimer(fn: () => void, ms: number): Timer {
  return setTimeout(fn, ms).unref()
}
