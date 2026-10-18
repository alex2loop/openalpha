import type { LLMErrorCode } from '@/core/llm'
import type { TokenUsage } from '@/core/stream-events'
import { classifyHttpError, classifyNetworkError, unwrapOpenRouterBody } from '@/ai/adapters/errors'
import { isAbortError, LLMError } from '@/core/errors'
import { parseRetryAfterMs } from '@/core/http-client'
import { RETRY_MAX_DELAY_MS } from '@/core/utils/retry'

const ERROR_BODY_CAP_BYTES = 4096

// Only a code the chain waits on can spend the header. `rate` is the one that always carries it:
// a 429 states when the window reopens, and reading it is what keeps the cooldown honest.
const RETRY_AFTER_CODES: ReadonlySet<LLMErrorCode> = new Set(['transient', 'rate'])

// A request the provider answered with an error status never started a generation: nothing to bill.
// A failure after the stream opened is different (a stall costs real money) and is estimated.
const REFUSED_USAGE: TokenUsage = { input: 0, output: 0 }

interface OpenSseStreamOptions {
  readonly now?: () => number
}

// LLM endpoints are boot-time trusted config (the frozen catalog, or an operator's `[[models]]
// base_url`), never a URL an agent or a document can steer. They are the same trust class as
// core/net/http-client's fixed hosts, so they intentionally skip NetworkPolicy.guardedFetch: that
// guard exists for untrusted URLs and would reject the API-key header as an outbound secret leak
// and refuse the http://localhost endpoints that ollama, lmstudio and vllm serve on.
export async function openSseStream(
  url: string,
  init: RequestInit,
  options: OpenSseStreamOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetchOrThrow(url, init)

  if (!response.ok) {
    const body = unwrapOpenRouterBody(await readErrorBody(response))
    const err = classifyHttpError(response.status, body)
    const retryAfterMs = RETRY_AFTER_CODES.has(err.code)
      ? parseRetryAfterMs(
          response.headers.get('retry-after'),
          (options.now ?? Date.now)(),
          RETRY_MAX_DELAY_MS
        )
      : undefined

    throw new LLMError(err.code, err.message, {
      cause: err,
      usage: REFUSED_USAGE,
      usageSource: 'estimated',
      ...(err.fallbackAllowed ? { fallbackAllowed: true } : {}),
      ...(err.answeredByProvider ? { answeredByProvider: true } : {}),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    })
  }

  if (!response.body) {
    throw new LLMError('fatal', `response has no body (HTTP ${response.status})`)
  }

  return response.body
}

async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  try {
    return await globalThis.fetch(url, init)
  } catch (err: unknown) {
    // The caller's abort is their own signal coming back — it is not a provider failure.
    if (isAbortError(err)) {
      throw err
    }

    throw classifyNetworkError(err)
  }
}

// A hostile or broken endpoint can stream an unbounded error body; read only what we will log.
// Bytes are capped exactly and decoded once — a per-chunk decode caps UTF-16 code units instead.
async function readErrorBody(response: Response): Promise<string> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0

  try {
    while (bytes < ERROR_BODY_CAP_BYTES) {
      const { value, done } = await reader.read()

      if (done) {
        break
      }

      const kept = value.subarray(0, ERROR_BODY_CAP_BYTES - bytes)
      bytes += kept.byteLength
      chunks.push(kept)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}
