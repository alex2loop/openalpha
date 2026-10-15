import type { AccessToken } from '@/ai/auth/types'
import { attributionHeaders } from '@/ai/auth/attribution'
import { readRecord, readString } from '@/ai/auth/json'
import { isAbortError, LLMError } from '@/core/errors'
import { HttpRequestError, httpRequest } from '@/core/http-client'
import { MS_PER_SECOND } from '@/core/utils/time'

export const TOKEN_TIMEOUT_MS = 30_000
export const TOKEN_MAX_BYTES = 65_536
// A refused grant stays refused until the operator fixes the credential; anything else may pass.
const PERMANENT_STATUSES: ReadonlySet<number> = new Set([400, 401, 403])

interface AccessTokenRequest {
  /** Names the issuer in the error, never the credential. */
  readonly issuer: string
  readonly host: string
  readonly path: string
  readonly form: Readonly<Record<string, string>>
}

/** Posts a token grant and reads back a short-lived bearer token, for the cloud sign-ins. */
export async function requestAccessToken(request: AccessTokenRequest): Promise<AccessToken> {
  try {
    const response = await httpRequest({
      hosts: [request.host],
      path: request.path,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...attributionHeaders() },
      body: new URLSearchParams(request.form).toString(),
      maxBytes: TOKEN_MAX_BYTES,
      timeoutMs: TOKEN_TIMEOUT_MS,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })

    return toAccessToken(response.text, request.issuer)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw new LLMError('timeout', `${request.issuer} token request timed out`, { cause: err })
    }

    throw toTokenRequestError(err, request.issuer)
  }
}

export function toTokenRequestError(err: unknown, issuer: string): Error {
  if (err instanceof LLMError) {
    return err
  }

  const status = err instanceof HttpRequestError ? err.status : undefined
  const permanent = status !== undefined && PERMANENT_STATUSES.has(status)

  return new LLMError(
    permanent ? 'auth' : 'transient',
    `${issuer} token request failed${status === undefined ? '' : ` (HTTP ${status})`}`,
    { cause: err instanceof Error ? err : undefined }
  )
}

function toAccessToken(text: string, issuer: string): AccessToken {
  const json = readRecord(JSON.parse(text))
  const accessToken = readString(json?.access_token)
  const lifetime = json?.expires_in

  if (accessToken === undefined || typeof lifetime !== 'number') {
    throw new LLMError('auth', `${issuer} token response is missing required fields`)
  }

  return { accessToken, expiresAt: Date.now() + lifetime * MS_PER_SECOND }
}
