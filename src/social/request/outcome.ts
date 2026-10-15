import type { RequestContext, RequestDeps, RequestRefusal } from '@/social/request/checks'
import type { SocialHttpResponse } from '@/social/request/send'
import { ToolError } from '@/core/errors'
import { parseRetryAfterMs } from '@/core/http-client'
import { formatErrForLog } from '@/core/security/credentials'
import { stripControls } from '@/core/utils/text'
import { MS_PER_DAY, MS_PER_MINUTE } from '@/core/utils/time'
import { EXCERPT_CHARS } from '@/social/constants'
import { returnedIdOf } from '@/social/json'
import { notifySafely } from '@/social/notices'
import { isOkStatus, sendSocialRequest } from '@/social/request/send'

/** Five 403 answers in a row pause a membership; one does not, because an unclaimed agent meets
 *  them by design. */
const FORBIDDEN_STREAK_LIMIT = 5
/** A 429 that names no retry time cools the membership for this long; one naming more than a day
 *  is capped at a day. */
const RATE_LIMIT_FALLBACK_MS = MS_PER_MINUTE
const RATE_LIMIT_CAP_MS = MS_PER_DAY
const KEY_MASK = '[key]'
const MAX_RATE_HEADERS = 6
const RATE_HEADER_RE = /^(retry-after|x-ratelimit-)/i
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_TOO_MANY = 429

export type SocialReply =
  /** `status` is absent when no answer came back at all (timeout, refused connection, oversize). */
  | { readonly kind: 'text'; readonly text: string; readonly status?: number }
  | {
      readonly kind: 'refused'
      readonly refusal: RequestRefusal | 'unknown-file' | 'drafted'
      readonly params?: Readonly<Record<string, string | number>>
    }

interface Outcome {
  readonly context: RequestContext
  readonly response: SocialHttpResponse
  readonly now: number
}

export async function executeRequest(
  deps: RequestDeps,
  context: RequestContext,
  signal: AbortSignal
): Promise<SocialReply> {
  const { input, apiKey } = context
  let response: SocialHttpResponse

  try {
    response = await sendSocialRequest(
      {
        apiBase: context.pin.apiBase,
        method: input.method,
        path: context.path,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(context.bodyText === undefined ? {} : { body: context.bodyText }),
        apiKey,
      },
      signal
    )
  } catch (err: unknown) {
    // A 3xx, a 5xx, an oversize body and a timeout are all a `ToolError`; an abort is not.
    if (err instanceof ToolError) {
      return { kind: 'text', text: redactKey(err.message, apiKey) }
    }

    throw err
  }

  return await classify(deps, context, response)
}

async function recordStatus(deps: RequestDeps, outcome: Outcome): Promise<void> {
  const { status } = outcome.response

  if (isOkStatus(status)) {
    await recordSuccess(deps, outcome)
  } else if (status === HTTP_UNAUTHORIZED) {
    await refuseKey(deps, outcome)
  } else if (status === HTTP_FORBIDDEN) {
    await countForbidden(deps, outcome)
  } else if (status === HTTP_TOO_MANY) {
    await coolDown(deps, outcome)
  }
}

async function classify(
  deps: RequestDeps,
  context: RequestContext,
  response: SocialHttpResponse
): Promise<SocialReply> {
  const outcome: Outcome = { context, response, now: deps.now() }
  const { status } = response

  try {
    await recordStatus(deps, outcome)
  } catch (err: unknown) {
    // The request already went out: the model must still read the answer, or it sends it again.
    deps.logger.error('social.outcome_record_failed', {
      network: context.input.network,
      status,
      err: formatErrForLog(err),
    })
  }

  return {
    kind: 'text',
    status,
    text: redactKey(
      `HTTP ${status}${rateLines(response.headers)}\n${response.text}`,
      context.apiKey
    ),
  }
}

async function recordSuccess(deps: RequestDeps, outcome: Outcome): Promise<void> {
  const { context, response, now } = outcome
  const { input, label, membership } = context

  if (label !== 'read') {
    const returnedId = returnedIdOf(response.text)

    await deps.store.recordWrite({
      id: Bun.randomUUIDv7(),
      agentId: input.agentId,
      network: input.network,
      label,
      bodyHash: context.bodyHash ?? '',
      excerpt: stripControls(context.bodyText ?? '').slice(0, EXCERPT_CHARS),
      ...(returnedId === undefined ? {} : { returnedId }),
      at: now,
    })
  }

  if (membership.forbiddenStreak > 0) {
    await deps.store.clearForbidden(input.agentId, input.network)
  }
}

async function refuseKey(deps: RequestDeps, outcome: Outcome): Promise<void> {
  const { agentId, network } = outcome.context.input
  const { now } = outcome
  const changed = await deps.store.setMembershipState(agentId, network, {
    state: 'refused',
    at: now,
  })

  if (changed) {
    await notifySafely(deps.notifier, deps.logger, { kind: 'key-refused', agentId, network })
  }
}

async function countForbidden(deps: RequestDeps, outcome: Outcome): Promise<void> {
  const { agentId, network } = outcome.context.input
  const { now } = outcome
  const streak = await deps.store.countForbidden(agentId, network)

  if (streak < FORBIDDEN_STREAK_LIMIT) {
    return
  }

  const changed = await deps.store.setMembershipState(agentId, network, {
    state: 'paused',
    at: now,
  })

  if (changed) {
    await notifySafely(deps.notifier, deps.logger, { kind: 'member-paused', agentId, network })
  }
}

async function coolDown(deps: RequestDeps, outcome: Outcome): Promise<void> {
  const { context, response, now } = outcome
  const wait =
    parseRetryAfterMs(response.headers.get('retry-after'), now, RATE_LIMIT_CAP_MS) ??
    RATE_LIMIT_FALLBACK_MS

  await deps.store.setCooldown(context.input.agentId, context.input.network, now + wait)
}

/** The exact key string, because pattern scrubbing does not know network key formats. */
function redactKey(text: string, key: string): string {
  return text.split(key).join(KEY_MASK)
}

function rateLines(headers: Headers): string {
  const lines: string[] = []

  for (const [name, value] of headers.entries()) {
    if (RATE_HEADER_RE.test(name) && lines.length < MAX_RATE_HEADERS) {
      lines.push(`${name}: ${stripControls(value)}`)
    }
  }

  return lines.length === 0 ? '' : `\n${lines.join('\n')}`
}

/** A refusal's copy names the network, which the checks do not repeat in every refusal. */
export function refusedReply(
  refusal: {
    readonly refusal: RequestRefusal
    readonly params?: Readonly<Record<string, string | number>>
  },
  network: string
): Extract<SocialReply, { kind: 'refused' }> {
  return { kind: 'refused', refusal: refusal.refusal, params: { network, ...refusal.params } }
}
