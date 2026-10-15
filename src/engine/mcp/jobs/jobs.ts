import { randomUUID } from 'node:crypto'

import type { Logger } from '@/core/logging/logger'
import type { ToolResult } from '@/core/tool'
import type { PendingRequest, RequestBroker } from '@/engine/mcp/jobs/broker'
import type {
  McpJobAnswer,
  McpJobAnswerItem,
  McpJobCall,
  McpJobRefusal,
  McpJobReply,
  McpJobResume,
  McpJobStart,
  McpJobView,
} from '@/engine/mcp/jobs/types'
import type { McpSurface } from '@/engine/mcp/surface'
import { withClientModelJob } from '@/ai/api'
import { RunHalted } from '@/core/errors'
import { sessionId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { MCP_CALL_WAIT_MS } from '@/engine/constants'
import { toolFailure } from '@/engine/mcp/invoke'
import {
  clearJobTimers,
  clearWaitTimers,
  finishedReply,
  type McpJob,
  type ReplyShape,
  refused,
  requestsReply,
  startTimer,
  workingReply,
} from '@/engine/mcp/jobs/job'
import { normalizeModelName } from '@/engine/mcp/jobs/tools'

/** Short, so `history`'s 8-character id column still shows part of the job id. */
const JOB_SESSION_PREFIX = 'mcp_'
/** Bounds memory when a client fires many quick calls at once. */
const MAX_LIVE_JOBS = 16
const MAX_ANSWER_BYTES = 262_144
/** A finished run nobody is waiting on keeps its result this long for the next call. */
const RESULT_RETENTION_MS = 300_000
/** Requests one wave posts together land within milliseconds, so they reach the client in one
 *  reply. */
const REQUEST_BATCH_MS = 50
const DRAIN_TIMEOUT_MS = 5_000

type TeardownReason = 'completed' | 'expired' | 'cancelled' | 'closing'

interface McpJobsDeps {
  readonly surface: McpSurface
  readonly broker: RequestBroker
  readonly logger: Logger
  /** Already capped below `[loop] max_duration_ms`. */
  readonly answerTimeoutMs: number
}

interface JobsState {
  readonly deps: McpJobsDeps
  readonly jobs: Map<string, McpJob>
  readonly running: Set<Promise<void>>
  closing: boolean
}

interface WaitOptions {
  readonly call: McpJobCall
  readonly cancelsJob: boolean
  readonly shape: ReplyShape
}

/** The call that starts a job never asked for inline requests; it hears them on resume. */
const START_SHAPE: ReplyShape = Object.freeze({ inline: false, collectsResult: true })

export interface McpJobs {
  start(call: McpJobStart): Promise<McpJobReply>
  view(call: McpJobView): McpJobReply
  answer(call: McpJobAnswer): Promise<McpJobReply>
  resume(call: McpJobResume): Promise<McpJobReply>
  drain(): Promise<void>
}

/** Every exit - finished, expired, cancelled, shutting down - goes through `teardownJob`. At most
 *  one call waits on a job, through `job.waiter`. */
export function createMcpJobs(deps: McpJobsDeps): McpJobs {
  const state: JobsState = { deps, jobs: new Map(), running: new Set(), closing: false }

  return {
    start: (call) => startJob(state, call),
    view: (call) => viewRequest(state, call),
    answer: (call) => answerRequests(state, call),
    resume: (call) => resumeJob(state, call),
    drain: () => drainJobs(state),
  }
}

async function startJob(state: JobsState, call: McpJobStart): Promise<McpJobReply> {
  if (call.signal.aborted) {
    return refused('expired')
  }

  if (state.closing) {
    return refused('closing')
  }

  if (state.jobs.size >= MAX_LIVE_JOBS) {
    return refused('full')
  }

  const job: McpJob = {
    id: randomUUID(),
    controller: new AbortController(),
    viewedAt: new Map(),
    closed: false,
  }

  state.jobs.set(job.id, job)
  state.deps.broker.open(job.id, () => onRequestPosted(state, job))
  launchJob(state, job, call)

  return await waitForJob(state, job, { call, cancelsJob: true, shape: START_SHAPE })
}

function launchJob(state: JobsState, job: McpJob, call: McpJobStart): void {
  const run = withClientModelJob(job.id, () =>
    state.deps.surface.invoke({
      name: call.name,
      input: call.input,
      signal: job.controller.signal,
      sessionId: sessionId(`${JOB_SESSION_PREFIX}${job.id}`),
      ...(call.approval === undefined ? {} : { approval: call.approval }),
      progress: (message) => job.waiter?.progress?.(message),
    })
  )
  const tracked: Promise<void> = run
    .then(
      (result) => onJobSettled(state, job, result),
      (err: unknown) => onJobSettled(state, job, toolFailure(formatErrForLog(err).message))
    )
    .catch((err: unknown) => {
      state.deps.logger.error('mcp.job_settle_failed', { jobId: job.id, err: formatErrForLog(err) })
    })
    .finally(() => state.running.delete(tracked))

  state.running.add(tracked)
}

function onJobSettled(state: JobsState, job: McpJob, result: ToolResult): void {
  if (job.closed) {
    return
  }

  job.result = result
  clearTimeout(job.idleTimer)
  job.idleTimer = undefined

  if (job.waiter?.collectsResult === true) {
    job.waiter.settle({ kind: 'result', result })
    teardownJob(state, job, 'completed')
    return
  }

  job.waiter?.settle(finishedReply(job.id))
  job.retentionTimer = startTimer(() => teardownJob(state, job, 'expired'), RESULT_RETENTION_MS)
}

function onRequestPosted(state: JobsState, job: McpJob): void {
  // A new request is never older than one already pending, so a running clock is still right.
  if (job.idleTimer === undefined) {
    armIdleTimer(state, job)
  }

  if (job.waiter === undefined || job.batchTimer !== undefined) {
    return
  }

  job.batchTimer = startTimer(() => {
    job.batchTimer = undefined
    deliverPending(state, job)
  }, REQUEST_BATCH_MS)
}

function deliverPending(state: JobsState, job: McpJob): void {
  const pending = state.deps.broker.pending(job.id)

  if (job.waiter === undefined || pending.length === 0) {
    return
  }

  job.waiter.settle(requestsReply(job.id, pending, job.waiter.inline))
}

/** Times the oldest pending request, and stops while none is: answering one request never buys
 *  time for a sibling, and server work between waves never counts as the client going quiet. */
function armIdleTimer(state: JobsState, job: McpJob): void {
  clearTimeout(job.idleTimer)
  job.idleTimer = undefined

  const oldest = state.deps.broker.oldestPendingAt(job.id)

  if (oldest === undefined) {
    return
  }

  const remainingMs = oldest + state.deps.answerTimeoutMs - performance.now()

  if (remainingMs <= 0) {
    expireJob(state, job)
    return
  }

  job.idleTimer = startTimer(() => armIdleTimer(state, job), remainingMs)
}

function expireJob(state: JobsState, job: McpJob): void {
  state.deps.logger.warn('mcp.job_expired', {
    jobId: job.id,
    pending: state.deps.broker.pending(job.id).length,
  })
  teardownJob(state, job, 'expired')
}

function waitForJob(state: JobsState, job: McpJob, options: WaitOptions): Promise<McpJobReply> {
  // Before handing anything out: a reply to an aborted call is dropped, and requests handed to it
  // would leave the job waiting on a client that never saw them.
  if (options.call.signal.aborted) {
    return Promise.resolve(releaseAbortedCall(state, job, options))
  }

  if (job.result !== undefined) {
    return Promise.resolve(collectResult(state, job, options))
  }

  const pending = state.deps.broker.pending(job.id)

  if (pending.length > 0) {
    return Promise.resolve(requestsReply(job.id, pending, options.shape.inline))
  }

  return new Promise((resolve) => {
    const onAbort = (): void => {
      const reply = releaseAbortedCall(state, job, options)

      job.waiter?.settle(reply)
    }

    options.call.signal.addEventListener('abort', onAbort, { once: true })
    job.waitTimer = startTimer(() => {
      job.waiter?.settle(workingReply(job.id))
    }, MCP_CALL_WAIT_MS)
    job.waiter = {
      ...(options.call.progress === undefined ? {} : { progress: options.call.progress }),
      ...options.shape,
      settle: (reply) => {
        options.call.signal.removeEventListener('abort', onAbort)
        clearWaitTimers(job)
        job.waiter = undefined
        resolve(reply)
      },
    }
  })
}

function collectResult(state: JobsState, job: McpJob, options: WaitOptions): McpJobReply {
  if (job.result === undefined || !options.shape.collectsResult) {
    return finishedReply(job.id)
  }

  const reply: McpJobReply = { kind: 'result', result: job.result }

  teardownJob(state, job, 'completed')

  return reply
}

/** A starting call owns its job, so its abort cancels the job; an answering call only lets go. */
function releaseAbortedCall(state: JobsState, job: McpJob, options: WaitOptions): McpJobReply {
  if (options.cancelsJob) {
    teardownJob(state, job, 'cancelled')
  }

  return refused('expired')
}

async function resumeJob(state: JobsState, call: McpJobResume): Promise<McpJobReply> {
  const job = state.jobs.get(call.continuation)

  if (job === undefined) {
    return refused('unknown')
  }

  if (job.waiter !== undefined) {
    return refused('busy')
  }

  return await waitForJob(state, job, {
    call,
    cancelsJob: false,
    shape: { inline: call.inline, collectsResult: true },
  })
}

/** Read-only: viewing a request neither answers it nor moves its clock. */
function viewRequest(state: JobsState, call: McpJobView): McpJobReply {
  const job = state.jobs.get(call.continuation)

  if (job === undefined) {
    return refused('unknown')
  }

  const pending = state.deps.broker.request(job.id, call.requestId)

  if (pending === undefined) {
    return refused('not_pending')
  }

  noteViewed(state, job, pending)

  return { kind: 'request', request: pending.request }
}

/** All or nothing: a batch with one stale, repeated or oversized answer records none of them. Only
 *  the call that closes the round waits for the next one - a sibling still open, or a call already
 *  waiting on the job, owns that step. */
async function answerRequests(state: JobsState, call: McpJobAnswer): Promise<McpJobReply> {
  const job = state.jobs.get(call.continuation)

  if (job === undefined) {
    return refused('unknown')
  }

  const refusal = answersRefusal(state, job, call.answers)

  if (refusal !== undefined) {
    return refused(refusal)
  }

  const model = normalizeModelName(call.model)

  for (const item of call.answers) {
    recordAnswer(state, job, { item, model })
  }

  armIdleTimer(state, job)

  if (state.deps.broker.pending(job.id).length > 0 || job.waiter !== undefined) {
    return { kind: 'answered' }
  }

  // An answering subagent hands back `finished` rather than the result; an inline caller is the
  // one that reports it.
  return await waitForJob(state, job, {
    call,
    cancelsJob: false,
    shape: { inline: call.inline, collectsResult: call.inline },
  })
}

function answersRefusal(
  state: JobsState,
  job: McpJob,
  answers: readonly McpJobAnswerItem[]
): McpJobRefusal | undefined {
  if (answers.some((item) => Buffer.byteLength(item.output, 'utf8') > MAX_ANSWER_BYTES)) {
    return 'too_large'
  }

  const distinct = new Set(answers.map((item) => item.requestId)).size === answers.length
  const allPending = answers.every(
    (item) => state.deps.broker.request(job.id, item.requestId) !== undefined
  )

  return distinct && allPending ? undefined : 'not_pending'
}

function recordAnswer(
  state: JobsState,
  job: McpJob,
  answer: { readonly item: McpJobAnswerItem; readonly model: string }
): void {
  const { item, model } = answer
  const pending = state.deps.broker.request(job.id, item.requestId)

  if (pending === undefined) {
    return
  }

  state.deps.broker.answer(job.id, item.requestId, { text: item.output, model })
  noteAnswered(state, job, pending)
}

/** Splits a request's wait into the client reaching it and the client answering it. */
function noteViewed(state: JobsState, job: McpJob, pending: PendingRequest): void {
  const { id, role } = pending.request

  if (job.viewedAt.has(id)) {
    return
  }

  const now = performance.now()

  job.viewedAt.set(id, now)
  state.deps.logger.debug('mcp.request_viewed', {
    jobId: job.id,
    requestId: id,
    role,
    waitedMs: Math.round(now - pending.postedAt),
  })
}

function noteAnswered(state: JobsState, job: McpJob, pending: PendingRequest): void {
  const { id, role } = pending.request
  const now = performance.now()
  const viewedAt = job.viewedAt.get(id)

  job.viewedAt.delete(id)
  state.deps.logger.debug('mcp.request_answered', {
    jobId: job.id,
    requestId: id,
    role,
    waitedMs: Math.round(now - pending.postedAt),
    ...(viewedAt === undefined ? {} : { answerMs: Math.round(now - viewedAt) }),
  })
}

function teardownJob(state: JobsState, job: McpJob, reason: TeardownReason): void {
  if (job.closed) {
    return
  }

  job.closed = true
  state.jobs.delete(job.id)

  try {
    const halted = new RunHalted('abort', `mcp job ${reason}`)

    clearJobTimers(job)

    if (job.result === undefined) {
      job.controller.abort(halted)
    }

    state.deps.broker.close(job.id, halted)
    job.waiter?.settle(refused(reason === 'closing' ? 'closing' : 'expired'))
  } catch (err: unknown) {
    state.deps.logger.warn('mcp.job_teardown_failed', {
      jobId: job.id,
      reason,
      err: formatErrForLog(err),
    })
  }
}

async function drainJobs(state: JobsState): Promise<void> {
  state.closing = true

  for (const job of [...state.jobs.values()]) {
    teardownJob(state, job, 'closing')
  }

  if (state.running.size === 0) {
    return
  }

  const settled = await settleWithin(Promise.allSettled(state.running), DRAIN_TIMEOUT_MS)

  if (!settled) {
    state.deps.logger.warn('mcp.job_drain_timeout', { running: state.running.size })
  }
}
