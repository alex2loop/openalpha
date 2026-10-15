// One retry policy for anything in scheduler/ that backs off on a failure count: jobs
// (job/outcome.ts) and heartbeat tasks (heartbeat/lease.ts) both use this base/cap
// instead of each inventing their own.
export const RETRY_BASE_MS = 60_000
export const RETRY_CAP_MS = 1_800_000
