import type { SendOutcome, SendResult } from './subscriptions'
import type { VapidKey } from './vapid'
import { listSubscriptions, recordSends } from './subscriptions'
import { buildVapidAuthorization, importVapidKey } from './vapid'

const PUSH_CONCURRENCY = 6
const PUSH_TIMEOUT_MS = 3_000
const PUSH_TTL_SECONDS = 14_400
const HTTP_OK_FROM = 200
const HTTP_OK_BELOW = 300

interface PushTarget {
  readonly endpoint: string
  readonly authorization: string
}

/** Wakes every subscribed phone with an empty push; the app reads the headline from `/api/latest`.
 *  It never rejects. A bad secret or a store failure ends the day's sends: the day is already
 *  claimed, so the cost is one missed day and never a second push. */
export async function sendDayPushes(
  db: D1Database,
  vapidSecret: string,
  now: number
): Promise<void> {
  try {
    const endpoints = await listSubscriptions(db)

    if (endpoints.length === 0) {
      return
    }

    const targets = await toTargets(endpoints, await importVapidKey(vapidSecret), now)

    await recordSends(db, await sendAll(targets))
  } catch {
    // Nothing to answer to: the claim stands and the next day pushes again.
  }
}

// One authorization per push origin, since its token names that origin.
async function toTargets(
  endpoints: readonly string[],
  key: VapidKey,
  now: number
): Promise<PushTarget[]> {
  const authorizations = new Map<string, string>()
  const targets: PushTarget[] = []

  for (const endpoint of endpoints) {
    const audience = new URL(endpoint).origin
    let authorization = authorizations.get(audience)

    if (authorization === undefined) {
      authorization = await buildVapidAuthorization({ audience, key, now })
      authorizations.set(audience, authorization)
    }

    targets.push({ endpoint, authorization })
  }

  return targets
}

// Rounds of at most PUSH_CONCURRENCY in flight: the cap of 45 is eight rounds of 3 s, inside the
// 30 s a `waitUntil` is given.
async function sendAll(targets: readonly PushTarget[]): Promise<SendResult[]> {
  const results: SendResult[] = []

  for (let start = 0; start < targets.length; start += PUSH_CONCURRENCY) {
    const round = targets.slice(start, start + PUSH_CONCURRENCY)

    results.push(...(await Promise.all(round.map(sendPush))))
  }

  return results
}

// Redirects are not followed: a push service answers in place, and an address is never chased.
async function sendPush(target: PushTarget): Promise<SendResult> {
  try {
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'normal',
        Authorization: target.authorization,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    })

    await response.body?.cancel()

    return { endpoint: target.endpoint, outcome: toSendOutcome(response.status) }
  } catch {
    // A network error or the deadline: the phone is not at fault yet, so it counts as a failure.
    return { endpoint: target.endpoint, outcome: 'failed' }
  }
}

function toSendOutcome(status: number): SendOutcome {
  if (status >= HTTP_OK_FROM && status < HTTP_OK_BELOW) {
    return 'sent'
  }

  if (status === 404 || status === 410) {
    return 'gone'
  }

  // 401 and 403: our own key is turned away, so no phone is judged by it.
  return status === 401 || status === 403 ? 'refused' : 'failed'
}
