import { z } from 'zod'

import type { ProfileSegmentBody } from '@/app/server/wire/trading'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toProfileWire } from '@/app/server/mappers/trading'
import { hostOf, localeOf, readJsonBody } from '@/app/server/routes/params'

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

export const PROFILE_SEGMENT_ROUTES = [
  { method: 'POST', path: '/v1/profile/segment', auth: true, handler: handleProfileSegment },
] as const satisfies readonly ApiRouteSpec[]
