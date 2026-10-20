import type { LLMErrorCode } from '@/core/llm'
import type { TokenUsage } from '@/core/stream-events'
import { LLMError } from '@/core/errors'

const CONTEXT_OVERFLOW_STATUSES: ReadonlySet<number> = new Set([400, 413, 422])

const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /context length exceeded/i,
  /context window/i,
  /exceeds the maximum number of tokens/i,
  /exceeds the.+context/i,
  /exceeds.+input limit/i,
  /input is too long/i,
  /input length .* exceeds/i,
  /max_model_len/i,
  /maximum context length/i,
  /n_ctx/i,
  /payload too large/i,
  /prompt is too long/i,
  /slot context/i,
  /string too long/i,
  /token limit exceeded/i,
  /too many tokens/i,
]

// "billing" alone is too broad — a 400 merely referencing a billing-address field would be
// misrouted. Require it to co-occur (within a short window, either order) with a limit/credit/quota
// signal so only genuine billing blocks classify as `billing`.
const BILLING_BLOCK_RE =
  /billing[\s\S]{0,60}(limit|quota|credit|hard|suspend|exceed|insufficient|inactive|disabled|denied|reached)|(limit|quota|credit|suspend|exceed|insufficient|inactive|disabled|denied|reached)[\s\S]{0,60}billing/i

// A plan's usage allowance, which Anthropic reports as a 429 alongside a `resets_at` days out.
// Left as the status map's `rate` it is briefly cooled, so the chain re-asks a provider that
// cannot answer until the allowance resets; `billing` pauses the whole provider instead.
const QUOTA_PATTERNS: readonly RegExp[] = [
  /insufficient_quota/i,
  /quota_exceeded/i,
  /usage_limit_reached/i,
  /usage limit[\s\S]{0,40}reached/i,
  BILLING_BLOCK_RE,
]

// Anthropic rejects a replayed thinking block whose signature it cannot verify, and gates some
// models behind a spend tier. Both are permanent for this request shape.
const ANTHROPIC_RECOVERY_PATTERNS: readonly RegExp[] = [/thinking_signature/i, /tier_gate/i]

// A strict backend's response_format refusal (oneOf unions, optional fields) is endpoint-specific:
// the next chain entry may tolerate the same schema, so the chain may advance despite `fatal`.
const SCHEMA_REJECTION_PATTERNS: readonly RegExp[] = [
  /invalid schema/i,
  /'(oneOf|anyOf|allOf)' is not permitted/i,
]

// A 402 that names a reset time is a rate limit wearing a payment status code.
const RATE_LIMITED_402_RE = /retry|resets at|rate.?limit|temporarily/i

// OpenRouter reports an unknown model id as 400, not 404. Left as `fatal` a typo'd or retired entry
// ends the run instead of falling through to the next one — the case the chain exists for.
const UNKNOWN_MODEL_PATTERNS: readonly RegExp[] = [
  /is not a valid model id/i,
  /model .{0,80}(?:not found|does not exist)/i,
]

const STATUS_CODES: Readonly<Record<number, LLMErrorCode>> = {
  401: 'auth',
  403: 'auth',
  404: 'not_found',
  402: 'billing',
  429: 'rate',
  // Request Timeout, Conflict and Too Early: the server asking for the same request again.
  408: 'transient',
  409: 'transient',
  425: 'transient',
}

// Codes whose wording blames the provider (a rejected key, no credit, no such model): true only
// of a refusal the provider sent, never of a sign-in, catalog or chain failure that shares the code.
const PROVIDER_VERDICT_CODES: ReadonlySet<LLMErrorCode> = new Set(['auth', 'billing', 'not_found'])

const SERVER_ERROR_STATUS = 500
const TOO_MANY_REQUESTS_STATUS = 429

// An error frame that names no status classifies as a server fault: a failure arriving mid-stream is
// overwhelmingly upstream overload, which the chain should fail over rather than end the run on.
const STREAM_ERROR_STATUS_FALLBACK = 500
const STREAM_FRAME_FALLBACK_BODY = 'stream failed'

const RETRYABLE_SYSCALLS: ReadonlySet<string> = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'])
const UNDICI_ERROR_PREFIX = 'UND_ERR_'
// Failed before the request left (Bun names a refused connect `ConnectionRefused`). A reset or
// timeout is not one: the provider may already have the request.
const NEVER_SENT_CODES: ReadonlySet<string> = new Set([
  'ConnectionRefused',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
])

// A request the provider refused or never received started no generation: nothing to bill.
// A failure after the stream opened is different (a stall costs real money) and is estimated.
export const REFUSED_USAGE: TokenUsage = { input: 0, output: 0 }

// The subset of a provider error body this module reads. Every field optional: the bodies are
// unvalidated JSON from 52 different vendors.
interface ErrorEnvelope {
  readonly message?: string
  readonly error?: { readonly message?: string; readonly metadata?: { readonly raw?: unknown } }
}

interface HttpErrorOptions {
  readonly retryAfterMs?: number
}

// A thrown fetch: no status, only a syscall code or a DOM error name.
export function classifyNetworkError(err: unknown): LLMError {
  const { code, name, message } = readErrorShape(err)

  if (name === 'TimeoutError') {
    return new LLMError('timeout', message || 'request timed out', { cause: err })
  }

  if (code !== undefined && NEVER_SENT_CODES.has(code)) {
    return new LLMError('transient', message || code, {
      cause: err,
      usage: REFUSED_USAGE,
      usageSource: 'estimated',
    })
  }

  if (
    code !== undefined &&
    (RETRYABLE_SYSCALLS.has(code) || code.startsWith(UNDICI_ERROR_PREFIX))
  ) {
    return new LLMError('transient', message || code, { cause: err })
  }

  return new LLMError('transient', `network error: ${message}`, { cause: err })
}

// Status + body classification, identical across all three transports: it reads the HTTP status and
// the provider's own prose, neither of which is transport-specific.
export function classifyHttpError(
  status: number,
  body: string,
  options?: HttpErrorOptions
): LLMError {
  if (status === 402 && RATE_LIMITED_402_RE.test(body)) {
    return toProviderError('rate', body, options)
  }

  if (status === TOO_MANY_REQUESTS_STATUS && hasMatchingPattern(body, QUOTA_PATTERNS)) {
    return toProviderError('billing', body, options)
  }

  const mapped = STATUS_CODES[status]

  if (mapped) {
    return toProviderError(mapped, body, options)
  }

  if (status >= SERVER_ERROR_STATUS) {
    return toProviderError('transient', body, options)
  }

  if (
    CONTEXT_OVERFLOW_STATUSES.has(status) &&
    hasMatchingPattern(body, CONTEXT_OVERFLOW_PATTERNS)
  ) {
    return toProviderError('context_overflow', body)
  }

  if (status === 400 && hasMatchingPattern(body, UNKNOWN_MODEL_PATTERNS)) {
    return toProviderError('not_found', body)
  }

  if (status === 400 && hasMatchingPattern(body, QUOTA_PATTERNS)) {
    return toProviderError('billing', body)
  }

  if (
    status === 400 &&
    (hasMatchingPattern(body, ANTHROPIC_RECOVERY_PATTERNS) ||
      hasMatchingPattern(body, SCHEMA_REJECTION_PATTERNS))
  ) {
    return toProviderError('fatal', body, { fallbackAllowed: true })
  }

  return toProviderError('fatal', body)
}

/** The detail a halt carries for a failed model call. Absent where the code's wording would
 *  misplace the fault, and the run reads as its broad `llm_error`. */
export function haltDetailOf(err: LLMError): LLMErrorCode | undefined {
  return PROVIDER_VERDICT_CODES.has(err.code) && !err.answeredByProvider ? undefined : err.code
}

function toProviderError(
  code: LLMErrorCode,
  body: string,
  options?: HttpErrorOptions | { readonly fallbackAllowed: true }
): LLMError {
  return new LLMError(code, body, { ...options, answeredByProvider: true })
}

// A failure that lands after the response has started arrives as an SSE frame rather than an HTTP
// status. Each transport translates its frame to the status it would have carried, so classification
// itself stays in one place.
export function classifyStreamError(status: number | undefined, body: string): LLMError {
  return classifyHttpError(status ?? STREAM_ERROR_STATUS_FALLBACK, body)
}

// The same frame where the provider names its fault in words rather than a status: the transport
// supplies its own vocabulary, and an unlisted word reads as a server fault.
export function classifyStreamFrame(
  fault: unknown,
  statuses: Readonly<Record<string, number>>,
  message: unknown
): LLMError {
  const status = typeof fault === 'string' ? statuses[fault] : undefined
  const body = typeof message === 'string' && message !== '' ? message : STREAM_FRAME_FALLBACK_BODY

  return classifyStreamError(status, body)
}

// OpenRouter wraps the upstream provider's error as a JSON string in error.metadata.raw. Classifying
// the wrapper would read every upstream failure as a generic 400; unwrap to the real message first.
export function unwrapOpenRouterBody(body: string): string {
  const parsed = parseJson(body)
  const raw = parsed?.error?.metadata?.raw

  if (typeof raw !== 'string') {
    return body
  }

  const outer = parsed?.error?.message ?? parsed?.message ?? ''
  const nested = parseJson(raw)
  const inner = nested?.error?.message ?? nested?.message ?? raw

  return outer ? `${outer} ${inner}` : inner
}

function parseJson(text: string): ErrorEnvelope | undefined {
  try {
    const value: unknown = JSON.parse(text)

    // A body of a different shape reads back as undefined fields, which every caller handles.
    // why-safe: every ErrorEnvelope field is optional, so the only claim made here is "some object".
    return typeof value === 'object' && value !== null ? (value as ErrorEnvelope) : undefined
  } catch {
    // Provider error bodies are frequently plain text or HTML; that is not itself an error.
    return undefined
  }
}

function readErrorShape(err: unknown): { code?: string; name?: string; message: string } {
  if (!(err instanceof Error)) {
    return { message: String(err) }
  }

  const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined

  return { ...(code !== undefined ? { code } : {}), name: err.name, message: err.message }
}

function hasMatchingPattern(body: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(body))
}

/** Closed before the provider's own end-of-response frame: whatever arrived is incomplete, and
 *  finishing on it would read a cut-off answer as a finished one. */
export function truncatedStreamError(transport: string): LLMError {
  return new LLMError('transient', `${transport} stream ended before its final frame`)
}
