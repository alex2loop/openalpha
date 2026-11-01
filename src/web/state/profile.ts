import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { profileBlock } from '@/web/state/market'
import { loadSession } from '@/web/state/session'

/** Saves part of the investor profile. It acts on the running daemon at once, and the session is
 *  read again because a first profile completes a first-run step. Throws `ApiFailure`. */
export async function saveProfilePatch(patch: object): Promise<void> {
  await sendJson('POST', ROUTES.profile, { body: { patch } })
  profileBlock.retry()
  await loadSession(new AbortController().signal)
}

/** A segment the operator has not switched off: some cap leaves it room. */
export function isSegmentOn(profile: TradingProfileResponse, segment: string): boolean {
  const cap = profile.caps[segment]

  return cap === undefined || cap.maximumPositionPctNav > 0 || cap.maximumSegmentPctNav > 0
}
