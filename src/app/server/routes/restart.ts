import { z } from 'zod'

import type { RestartAcceptedWire, RestartBody } from '@/app/server/wire/system'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { RestartStart } from '@/app/update/restart'
import { apiError, json } from '@/app/server/http/dispatch'
import { localeOf } from '@/app/server/routes/params'
import { RESTART_WHEN } from '@/app/update/restart'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

const RESTART_BODY: z.ZodType<RestartBody> = z.object({ when: z.enum(RESTART_WHEN) })

const REFUSAL_KEYS = {
  busy: 'errors.restartPending',
  stopping: 'errors.restartStopping',
  foreground: 'errors.restartForeground',
} as const satisfies Record<Exclude<RestartStart, 'started'>, string>

/** Answers once the restart is accepted. The daemon then stops through its normal shutdown, which
 *  refuses the approvals still waiting; `idle` waits for the daemon to go quiet first. */
async function handleRestart(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = RESTART_BODY.safeParse(await req.json().catch(() => null))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  const outcome = await ctx.app.resolve('selfUpgrade').restart(parsed.data.when)

  if (outcome !== 'started') {
    return apiError('conflict', t(localeOf(ctx), REFUSAL_KEYS[outcome], { brand: BRAND.name }))
  }

  const refusedApprovals = ctx.live.snapshot().pending.filter((entry) => entry.kind === 'approval')

  return json({ refusedApprovals: refusedApprovals.length } satisfies RestartAcceptedWire, 202)
}

export const RESTART_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/restart', auth: true, handler: handleRestart },
]
