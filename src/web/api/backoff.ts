const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000

/** Equal jitter: the ceiling doubles per attempt up to `BACKOFF_MAX_MS`, and the delay is never under
 *  half of it, so a fleet of tabs spreads out without any of them retrying too soon. */
export function nextDelayMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)

  return ceiling / 2 + (random() * ceiling) / 2
}
