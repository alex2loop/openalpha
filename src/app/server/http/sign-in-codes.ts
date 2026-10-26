import { buildSecret, toSecretHash } from '@/app/server/http/auth'
import { MS_PER_MINUTE } from '@/core/utils/time'

const SIGN_IN_CODE_TTL_MS = 5 * MS_PER_MINUTE
const MAX_PENDING_CODES = 16

/** One-time codes a browser trades for a session. Held in memory only, so a restart drops them. */
export interface SignInCodes {
  issue(now: number): string
  /** True once for a code issued and not yet expired; the code is spent either way. */
  take(code: string, now: number): boolean
}

export function createSignInCodes(token: string): SignInCodes {
  // Hash -> expiry. Bounded by MAX_PENDING_CODES; expiry is checked on use, so no timer runs.
  const pending = new Map<string, number>()

  return {
    issue: (now) => {
      dropExpired(pending, now)

      while (pending.size >= MAX_PENDING_CODES) {
        const oldest = pending.keys().next().value

        if (oldest === undefined) {
          break
        }

        pending.delete(oldest)
      }

      const code = buildSecret()

      pending.set(toSecretHash(code, token), now + SIGN_IN_CODE_TTL_MS)

      return code
    },
    take: (code, now) => {
      const hash = toSecretHash(code, token)
      const expiresAt = pending.get(hash)

      pending.delete(hash)

      return expiresAt !== undefined && expiresAt > now
    },
  }
}

function dropExpired(pending: Map<string, number>, now: number): void {
  for (const [hash, expiresAt] of pending) {
    if (expiresAt <= now) {
      pending.delete(hash)
    }
  }
}
