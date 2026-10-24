import type { AgentId } from '@/core/ids'
import type { JobStore } from '@/scheduler/types'

/** Pauses every schedule of an agent that is on, one by one, and returns how many it paused: a
 *  schedule left on would keep firing at an agent id that no longer resolves. */
export async function pauseJobsOfAgent(store: JobStore, id: AgentId): Promise<number> {
  const jobs = (await store.list()).filter((job) => job.agentId === id && job.enabled)

  for (const job of jobs) {
    await store.pause(job.id)
  }

  return jobs.length
}
