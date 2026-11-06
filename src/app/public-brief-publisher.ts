import { z } from 'zod'

import type { PublicBriefCredential, PublicBriefPublisher, PublishOutcome } from '@/trading/api'
import { toPublicBriefDocument } from '@/app/server/mappers/public-brief'
import { BRAND } from '@/core/brand'
import { ToolError } from '@/core/errors'
import { HttpRequestError, httpRequest } from '@/core/http-client'

/** The one address the brief is posted to: no config, flag or argument names another. */
export const PUBLIC_BRIEF_HOSTNAME = `brief.${BRAND.publicDomain}`
const PUBLIC_BRIEF_HOST = `https://${PUBLIC_BRIEF_HOSTNAME}`
const PUBLIC_BRIEF_PUBLISH_PATH = '/api/publish'
const PUBLIC_BRIEF_PUBLISH_TIMEOUT_MS = 20_000
const ANSWER_MAX_BYTES = 4_096

const answerSchema = z.object({
  stored: z.boolean(),
  subscribers: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
})

/** Posts with the daemon's request shape, which follows no redirect, under a deadline. Nothing of
 *  the answer is kept but its counts, and no error text leaves here: a failure is `unreachable` or
 *  the status the public side refused with. Aborting the signal is shutdown and propagates. */
export function createPublicBriefPublisher(
  credential: PublicBriefCredential
): PublicBriefPublisher {
  return {
    async publish(render, signal) {
      const body = JSON.stringify(toPublicBriefDocument(render))

      try {
        const res = await httpRequest({
          hosts: [PUBLIC_BRIEF_HOST],
          path: PUBLIC_BRIEF_PUBLISH_PATH,
          method: 'POST',
          headers: {
            authorization: `Bearer ${credential.token}`,
            'content-type': 'application/json',
          },
          body,
          maxBytes: ANSWER_MAX_BYTES,
          timeoutMs: PUBLIC_BRIEF_PUBLISH_TIMEOUT_MS,
          signal,
        })

        return toOutcome(res.text)
      } catch (err: unknown) {
        return toFailure(err)
      }
    },
  }
}

/** A 2xx the daemon cannot read is retried: the publish is idempotent, so the second answer says
 *  the day is already held. */
function toOutcome(text: string): PublishOutcome {
  const answer = answerSchema.safeParse(parseJson(text))

  if (!answer.success) {
    return { kind: 'unreachable' }
  }

  const { stored, subscribers, rejected } = answer.data

  return { kind: stored ? 'stored' : 'unchanged', subscribers, rejected }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Only a request failure is the network's or the public side's. Anything else is this code being
 *  wrong, and goes up to be logged. */
function toFailure(err: unknown): PublishOutcome {
  if (!(err instanceof ToolError)) {
    throw err
  }

  return err instanceof HttpRequestError && err.status !== undefined
    ? { kind: 'refused', status: err.status }
    : { kind: 'unreachable' }
}
