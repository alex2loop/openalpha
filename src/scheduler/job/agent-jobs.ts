import type { AgentId } from '@/core/ids'
import type { Job, JobStore } from '@/scheduler/types'

/** Every job an agent has, whatever its state. */
export async function jobsOfAgent(store: JobStore, id: AgentId): Promise<readonly Job[]> {
  const jobs = await store.list()

  return jobs.filter((job) => job.agentId === id)
}

/** How many jobs an agent has, whatever their state: the count its cap is measured on. */
export async function countJobsOfAgent(store: JobStore, id: AgentId): Promise<number> {
  return (await jobsOfAgent(store, id)).length
}

/** Pauses every schedule of an agent that is on, one by one, and returns how many it paused: a
 *  schedule left on would keep firing at an agent id that no longer resolves. */
export async function pauseJobsOfAgent(store: JobStore, id: AgentId): Promise<number> {
  const jobs = await store.listEnabledOfAgent(id)

  for (const job of jobs) {
    await store.pause(job.id)
  }

  return jobs.length
}
