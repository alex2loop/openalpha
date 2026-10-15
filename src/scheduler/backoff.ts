// One retry policy for anything in scheduler/ that backs off on a failure count: jobs
// (job/outcome.ts) and heartbeat tasks (heartbeat/runner.ts) both use this base/cap and formula
// instead of each inventing their own.
export const RETRY_BASE_MS = 60_000
export const RETRY_CAP_MS = 1_800_000

export function computeBackoffMs(failures: number, baseMs: number, capMs: number): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, failures - 1))
}
