import type { SearchBackendResponse, SearchRequest } from '@/tools/web/search/types'
import { abortError, ToolError } from '@/core/errors'
import { HttpRequestError, httpRequestWithSignal, parseRetryAfterMs } from '@/core/http-client'
import { parseJsonBody } from '@/tools/web/search/body-cap'
import {
  isSearchRetryableStatus,
  SEARCH_RETRY_AFTER_MAX_MS,
  SearchProviderError,
  SearchRetryableError,
} from '@/tools/web/search/errors'

interface ApiKeyProviderOptions {
  readonly request: SearchRequest
  readonly endpoint: string
  readonly header: string
  readonly toHeaderValue?: (apiKey: string) => string
  readonly body: (request: SearchRequest) => string
  readonly parse: (value: unknown, maxResults: number) => SearchBackendResponse
}

export async function runApiKeyProvider(
  options: ApiKeyProviderOptions
): Promise<SearchBackendResponse> {
  const { request, endpoint, header, toHeaderValue, body, parse } = options
  return await runHostedProvider({
    authentication: 'required',
    ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
    signal: request.signal,
    endpoint,
    header,
    ...(toHeaderValue === undefined ? {} : { toHeaderValue }),
    body: body(request),
    parse: (value) => parse(value, request.maxResults),
  })
}

interface HostedProviderOptions<T> {
  readonly authentication: 'required' | 'optional'
  readonly apiKey?: string
  readonly signal: AbortSignal
  readonly endpoint: string
  readonly header: string
  readonly toHeaderValue?: (apiKey: string) => string
  readonly body: string
  readonly maxResponseBytes?: number
  readonly parse: (value: unknown) => T
}

export async function runHostedProvider<T>(options: HostedProviderOptions<T>): Promise<T> {
  if (options.authentication === 'required' && !options.apiKey) {
    throw new SearchProviderError('authentication', 'search provider is not configured')
  }

  const url = new URL(options.endpoint)
  const headerValue =
    options.apiKey === undefined
      ? undefined
      : (options.toHeaderValue?.(options.apiKey) ?? options.apiKey)

  try {
    const response = await httpRequestWithSignal({
      hosts: [url.origin],
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headerValue === undefined ? {} : { [options.header]: headerValue }),
      },
      body: options.body,
      ...(options.maxResponseBytes === undefined ? {} : { maxBytes: options.maxResponseBytes }),
      signal: options.signal,
    })
    return options.parse(parseJsonBody(response.text))
  } catch (err: unknown) {
    rethrowHostedProviderError(err, options.signal)
  }
}

function rethrowHostedProviderError(err: unknown, signal: AbortSignal): never {
  if (err instanceof SearchRetryableError || err instanceof SearchProviderError) {
    throw err
  }

  if (err instanceof ToolError && err.code === 'timeout') {
    throw new SearchRetryableError('search provider timed out', {
      retryAfterMs: 0,
      failureCode: 'timeout',
      code: 'timeout',
    })
  }

  if (err instanceof HttpRequestError) {
    throw classifyHttpRequestError(err)
  }

  if (signal.aborted) {
    throw abortError(signal)
  }

  throw err
}

function classifyHttpRequestError(err: HttpRequestError): Error {
  if (err.status === undefined) {
    return new SearchRetryableError('search provider transport failed', {
      retryAfterMs: 0,
      failureCode: 'transport',
      code: err.code,
    })
  }

  if (isSearchRetryableStatus(err.status)) {
    const nowMs = Date.now()
    const retryAfterMs = parseRetryAfterMs(err.retryAfter, nowMs, SEARCH_RETRY_AFTER_MAX_MS) ?? 0

    return new SearchRetryableError('search provider is temporarily unavailable', {
      retryAfterMs,
      failureCode: err.status === 429 ? 'rate_limited' : 'transport',
    })
  }

  if (err.status === 401 || err.status === 403) {
    return new SearchProviderError('authentication', 'search provider authentication failed')
  }

  if (err.status === 400 || err.status === 422) {
    return new SearchProviderError('invalid_request', 'search provider rejected the request')
  }

  return new SearchProviderError('transport', `search provider returned HTTP ${err.status}`)
}
