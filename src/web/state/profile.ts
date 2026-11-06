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
