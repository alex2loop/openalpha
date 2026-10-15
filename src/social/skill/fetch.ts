import { isAbortError, ToolError, ValidationError } from '@/core/errors'
import { readCappedText } from '@/core/http-client'
import { NetworkPolicy } from '@/core/ssrf/network-policy'

/** Moltbook's whole skill is 38 KB; a file seven times that is not a skill. */
const MAX_SKILL_BYTES = 262_144
const SKILL_FETCH_TIMEOUT_MS = 30_000

/** A skill file over https through the SSRF guard. A redirect may stay on the file's own host and
 *  nowhere else, and a body over the cap is a refusal, never a truncation. */
export async function fetchSkillFile(url: string, signal: AbortSignal): Promise<string> {
  const host = hostOf(url)
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(SKILL_FETCH_TIMEOUT_MS)])
  let response: Response

  try {
    response = (await NetworkPolicy.guardedFetch(url, { signal: bounded }, { allowlist: [host] }))
      .response
  } catch (err: unknown) {
    // Ctrl-C is a cancel, not an unreachable host.
    if (isAbortError(err) && signal.aborted) {
      throw err
    }

    throw new ValidationError(
      `skill fetch failed: ${url}`,
      { key: 'social.fetchFailed', params: { url } },
      err
    )
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new ValidationError(`skill fetch answered ${response.status}: ${url}`, {
      key: 'social.fetchStatus',
      params: { url, status: response.status },
    })
  }

  try {
    return await readCappedText(response, MAX_SKILL_BYTES)
  } catch (err: unknown) {
    if (err instanceof ToolError && err.code === 'payload_too_large') {
      throw new ValidationError(`skill file over ${MAX_SKILL_BYTES} bytes: ${url}`, {
        key: 'social.fetchTooLarge',
        params: { url, bytes: MAX_SKILL_BYTES },
      })
    }

    if (isAbortError(err) && signal.aborted) {
      throw err
    }

    // The timeout or a dropped connection part way through the body.
    throw new ValidationError(
      `skill fetch failed: ${url}`,
      { key: 'social.fetchFailed', params: { url } },
      err
    )
  }
}

/** A malformed address is the operator's typo, so it reads as one rather than a crash. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    throw new ValidationError(`not a url: ${url}`, { key: 'social.fetchFailed', params: { url } })
  }
}
