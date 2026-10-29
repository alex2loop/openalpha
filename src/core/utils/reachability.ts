import { lookup } from 'node:dns/promises'

import { sleep } from '@/core/utils/time'

/** IANA-reserved, so it resolves wherever any name does and names no provider the daemon reads. */
export const REACHABILITY_HOST = 'example.com'
export const REACHABILITY_TIMEOUT_MS = 5_000

/** The OS resolver, the path every outbound fetch takes: raw DNS or an address policy would gate on
 *  a different question than the one the caller is about to ask. Never throws; a name that does not
 *  resolve inside the budget, or whose caller aborts first, is offline. */
export async function probeHost(
  host: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) {
    return false
  }

  const resolved = lookup(host).then(
    () => true,
    () => false
  )
  // The lookup itself cannot be cancelled; this ends the wait on it, and the timer with it.
  const budget = new AbortController()
  const expired = sleep(
    timeoutMs,
    signal ? AbortSignal.any([signal, budget.signal]) : budget.signal
  )
    .then(() => false)
    .catch(() => false)

  try {
    return await Promise.race([resolved, expired])
  } finally {
    budget.abort()
  }
}
