import { z } from 'zod'

import type { DefaultTargetsResponse, ProfileSegmentBody } from '@/app/server/wire/trading'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toProfileWire } from '@/app/server/mappers/trading'
import { hostOf, localeOf, readJsonBody } from '@/app/server/routes/params'

// `?on=equity-vn,crypto`: the segments switched on, a handful at most.
const ON_SEPARATOR = ','
const MAX_SEGMENTS = 32
const SEGMENT_BODY: z.ZodType<ProfileSegmentBody> = z.object({
  action: z.enum(['enable', 'disable']),
  segment: z.string().min(1),
})

/** A segment switched on or off re-seeds every target and cap, as `/profile enable|disable` does;
 *  the answer is the profile after it. */
async function handleProfileSegment(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = SEGMENT_BODY.safeParse(await readJsonBody(req))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  const host = hostOf(ctx)
  const profile = await host.updateSegment({
    kind: parsed.data.action,
    segment: parsed.data.segment,
    signal: req.signal,
  })

  return json(toProfileWire(profile, localeOf(ctx), host.profileFields()))
}

/** What a re-seed would set with only the named segments on; nothing is saved. */
async function handleDefaultTargets(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const raw = new URL(req.url).searchParams.get('on') ?? ''
  const on = raw.split(ON_SEPARATOR).filter((segment) => segment !== '')

  if (on.length > MAX_SEGMENTS) {
    return apiError('invalid_body')
  }

  const segmentTargets = await hostOf(ctx).getDefaultTargets({ on, signal: req.signal })

  return json({ segmentTargets } satisfies DefaultTargetsResponse)
}

export const PROFILE_SEGMENT_ROUTES = [
  { method: 'POST', path: '/v1/profile/segment', auth: true, handler: handleProfileSegment },
  {
    method: 'GET',
    path: '/v1/profile/default-targets',
    auth: true,
    handler: handleDefaultTargets,
  },
] as const satisfies readonly ApiRouteSpec[]
