import type { RunResult } from '@/engine/api'
import type { Job, SchedulerDeps } from '@/scheduler/types'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'
import { createSchedulerApproval } from '@/scheduler/approval'

// Exported for scheduler/runner.ts: the run-now claim staleness TTL is sized off the same cap so
// the two never drift apart from separately-tuned constants.
export const JOB_MAX_DURATION_MS = 900_000
export interface JobExecution {
  readonly result: RunResult
  readonly denied: boolean
}

interface RunAgentOptions {
  readonly signal: AbortSignal
  readonly onWorkStart?: () => Promise<void>
}

export async function runAgent(
  job: Job,
  deps: SchedulerDeps,
  options: RunAgentOptions
): Promise<JobExecution> {
  const onWorkStart = startOnce(options.onWorkStart)
  const answer = await deps.runCommand(job, {
    signal: options.signal,
    ...(onWorkStart === undefined ? {} : { onWorkStart }),
  })

  if (answer?.kind === 'text') {
    return { result: toCommandResult(answer.text), denied: false }
  }

  const asked: Job =
    answer === undefined
      ? job
      : {
          ...job,
          prompt: answer.message,
          ...(answer.agentId === undefined ? {} : { agentId: answer.agentId }),
        }
  const jobApproval = job.target === undefined ? undefined : createSchedulerApproval(job)
  const input = deps.runInput(asked)
  const result = await deps.runner.run(
    job.target === undefined ? input : { ...input, channel: job.target.channel },
    {
      approvalMode: jobApproval === undefined ? 'unavailable' : 'manual',
      ...(jobApproval === undefined ? {} : { approval: jobApproval.approval }),
      ...(job.target === undefined ? {} : { chatId: job.target.chatId }),
      ...(job.allowedTools !== undefined && job.allowedTools.length > 0
        ? { allowedTools: job.allowedTools }
        : {}),
      approvalTimeoutMs: deps.config.schedule.approvalTimeoutMs,
      parentSignal: options.signal,
      ...(onWorkStart === undefined ? {} : { onWorkStart }),
      // Caps agent work only: the engine stops this clock while an approval prompt is open.
      maxDurationMs: JOB_MAX_DURATION_MS,
    }
  )

  return { result, denied: jobApproval?.hasDenied() === true }
}

// The command and the agent turn it may hand off to both announce the start; the run-now row opens once.
function startOnce(
  onWorkStart: (() => Promise<void>) | undefined
): (() => Promise<void>) | undefined {
  if (onWorkStart === undefined) {
    return undefined
  }

  let started: Promise<void> | undefined

  return () => (started ??= onWorkStart())
}

function toCommandResult(text: string): RunResult {
  return { reason: 'completed', text, totals: EMPTY_LLM_USAGE_TOTALS, workStarted: true }
}
