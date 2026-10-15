import { httpRequest } from '@/core/http-client'
import { apiBasePath, pinnedApiFetch } from '@/social/pin/api-base'

/** Non-2xx answers whose body the model or the operator should read, never failed over. */
const ERROR_BODY_STATUSES: readonly number[] = [400, 401, 403, 404, 409, 410, 422, 429]
const JSON_CONTENT_TYPE = 'application/json'
const REQUEST_TIMEOUT_MS = 15_000
/** A feed page is a few dozen KB; an answer past this is refused rather than cut. */
const MAX_RESPONSE_BYTES = 262_144
const HTTP_OK_FLOOR = 200
const HTTP_OK_CEILING = 300

export interface SocialSendInput {
  readonly apiBase: string
  readonly method: string
  /** Already matched against a pinned template and relative to the API base. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: string
  /** Absent only for registration. */
  readonly apiKey?: string
}

export interface SocialHttpResponse {
  readonly status: number
  readonly headers: Headers
  readonly text: string
}

/** The runtime's only way onto a network. The host is vetted on every request and the dial pinned
 *  to that address; `httpRequest` follows no redirect (a 3xx fails) and caps the body (over the cap
 *  fails, never truncates). The key goes in the header here and nowhere else. */
export async function sendSocialRequest(
  input: SocialSendInput,
  signal: AbortSignal
): Promise<SocialHttpResponse> {
  const fetchImpl = await pinnedApiFetch(input.apiBase, signal)
  const base = new URL(input.apiBase)

  return await httpRequest({
    hosts: [base.origin],
    path: `${apiBasePath(input.apiBase)}${input.path}`,
    method: input.method,
    ...(input.query === undefined ? {} : { query: { ...input.query } }),
    headers: {
      'content-type': JSON_CONTENT_TYPE,
      ...(input.apiKey === undefined ? {} : { authorization: `Bearer ${input.apiKey}` }),
    },
    ...(input.body === undefined ? {} : { body: input.body }),
    maxBytes: MAX_RESPONSE_BYTES,
    errorBodyStatuses: ERROR_BODY_STATUSES,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal,
    fetchImpl,
  })
}

export function isOkStatus(status: number): boolean {
  return status >= HTTP_OK_FLOOR && status < HTTP_OK_CEILING
}
