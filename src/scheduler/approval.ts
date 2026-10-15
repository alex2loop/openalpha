import type { ToolApproval } from '@/engine/api'
import type { Job } from '@/scheduler/types'

interface SchedulerApproval {
  readonly approval: ToolApproval
  hasDenied(): boolean
}

export function createSchedulerApproval(job: Job): SchedulerApproval {
  const deniedKeys = new Set<string>()

  return {
    approval: {
      scope: { kind: 'scheduler', jobId: job.id },
      status(key): 'denied' | 'prompt' {
        return deniedKeys.has(key) ? 'denied' : 'prompt'
      },
      deny(key): void {
        deniedKeys.add(key)
      },
    },
    hasDenied: () => deniedKeys.size > 0,
  }
}
