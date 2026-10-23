import type { JobId, SessionId } from '@/core/ids'
import { sessionId } from '@/core/ids'

const JOB_SESSION_PREFIX = 'job_'

/** The session every run of one job shares. A tool call can tell it is running inside a job by it. */
export function toJobSessionId(id: JobId): SessionId {
  return sessionId(`${JOB_SESSION_PREFIX}${id}`)
}
