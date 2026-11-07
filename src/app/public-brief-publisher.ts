import { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import type { PublicBriefCredential, PublicBriefPublisher, PublishOutcome } from '@/trading/api'
import { toPublicBriefDocument } from '@/app/server/mappers/public-brief'
import { BRAND } from '@/core/brand'
import { ToolError } from '@/core/errors'
import { HttpRequestError, httpRequest } from '@/core/http-client'

/** The one address the daemon posts the brief to: no config or flag names another. */
export const PUBLIC_BRIEF_HOSTNAME = `brief.${BRAND.publicDomain}`
const PUBLIC_BRIEF_ORIGIN = `https://${PUBLIC_BRIEF_HOSTNAME}`
const PUBLIC_BRIEF_PUBLISH_PATH = '/api/publish'
const PUBLIC_BRIEF_PUBLISH_TIMEOUT_MS = 20_000
const ANSWER_MAX_BYTES = 4_096
/** The public side refuses a body past 256 KiB for good, so the day would be lost: warn well
 *  before that. */
const PUBLIC_BRIEF_WARN_BYTES = 204_800

const answerSchema = z.object({ stored: z.boolean() })

/** Posts with the daemon's request shape, which follows no redirect, under a deadline. Nothing of
 *  the answer is kept but whether it stored, and no error text leaves here: a failure is
 *  `unreachable` or the status the public side refused with. Aborting the signal is shutdown and
 *  propagates. Only the dry-run script passes an origin of its own; the daemon binds the
 *  two-argument form. */
export function createPublicBriefPublisher(
  credential: PublicBriefCredential,
  logger: Logger,
  origin: string = PUBLIC_BRIEF_ORIGIN
): PublicBriefPublisher {
  return {
    async publish(render, signal) {
      const body = JSON.stringify(toPublicBriefDocument(render))
      const bytes = Buffer.byteLength(body)

      if (bytes > PUBLIC_BRIEF_WARN_BYTES) {
        logger.warn('trading.public_brief_large', { day: render.day, bytes })
      }

      try {
        const res = await httpRequest({
          hosts: [origin],
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
  const answer = answerSchema.safeParse(readJsonOrUndefined(text))

  if (!answer.success) {
    return { kind: 'unreachable' }
  }

  return { kind: answer.data.stored ? 'stored' : 'unchanged' }
}

function readJsonOrUndefined(text: string): unknown {
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
