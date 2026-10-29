import { lookup } from 'node:dns/promises'

import { settleWithin } from '@/core/utils/concurrency'

/** IANA-reserved, so it resolves wherever any name does and names no provider the daemon reads. */
export const REACHABILITY_HOST = 'example.com'
export const REACHABILITY_TIMEOUT_MS = 5_000

/** The OS resolver, the path every outbound fetch takes: raw DNS or an address policy would gate on
 *  a different question than the one the caller is about to ask. Never throws; a name that does not
 *  resolve inside the budget is offline. */
export async function probeHost(host: string, timeoutMs: number): Promise<boolean> {
  const resolved = lookup(host).then(
    () => true,
    () => false
  )

  return (await settleWithin(resolved, timeoutMs)) && (await resolved)
}
