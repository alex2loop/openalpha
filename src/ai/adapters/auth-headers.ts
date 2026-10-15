import type { ChainEntry } from '@/ai/types'
import type { LLMRequest } from '@/core/llm'
import { keyedHeaders } from '@/ai/adapters/runner'
import { isAbortError, LLMError } from '@/core/errors'

/** An API key when the model has one, else the provider's login or cloud account. Runs inside the
 *  attempt boundary: a corrupted token file throws a raw ConfigError, which must become a
 *  fallback-eligible LLMError here rather than escape and skip the rest of the provider chain. */
export async function resolveAuthHeaders(
  req: LLMRequest,
  entry: ChainEntry
): Promise<Readonly<Record<string, string>>> {
  if (entry.credentials === undefined) {
    return keyedHeaders(
      entry.apiKey,
      entry.provider.authStyle === 'api_key_header'
        ? { 'api-key': entry.apiKey }
        : { authorization: `Bearer ${entry.apiKey}` }
    )
  }

  try {
    return await entry.credentials.authHeaders()
  } catch (err: unknown) {
    if (req.signal.aborted || isAbortError(err) || err instanceof LLMError) {
      throw err
    }

    throw new LLMError('auth', 'failed to resolve provider credentials', { cause: err })
  }
}
