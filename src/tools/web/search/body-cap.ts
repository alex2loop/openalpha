import { SearchProviderError } from '@/tools/web/search/errors'

const SEARCH_BODY_MAX_BYTES = 2_097_152

export function parseJsonBody(raw: string): unknown {
  if (Buffer.byteLength(raw, 'utf8') > SEARCH_BODY_MAX_BYTES) {
    throw new SearchProviderError('content_limit', 'search response exceeds size cap')
  }
  try {
    const value: unknown = JSON.parse(raw)
    return value
  } catch (err: unknown) {
    throw new SearchProviderError('invalid_response', 'search provider returned invalid JSON', {
      cause: err,
    })
  }
}
