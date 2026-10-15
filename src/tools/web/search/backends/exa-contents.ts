import type { ExaContentsResponse } from '@/tools/web/search/types'
import { runHostedProvider } from '@/tools/web/search/backends/api-key-provider'
import {
  EXA_API_ORIGIN,
  EXA_AUTHORIZATION_HEADER,
  EXA_BEARER_PREFIX,
  EXA_CONTENTS_PATH,
  exaContentsBody,
  parseExaContentsResponse,
} from '@/tools/web/search/backends/exa-protocol'

interface ExaContentsRequest {
  readonly apiKey?: string
  readonly urls: readonly string[]
  readonly query: string
  readonly maxTextCharacters: number
  readonly maxResponseBytes: number
  readonly excerptMaxCharacters: number
  readonly signal: AbortSignal
}

export async function exaContents(request: ExaContentsRequest): Promise<ExaContentsResponse> {
  const retrievedAt = Date.now()
  const response = await runHostedProvider<ExaContentsResponse>({
    authentication: 'required',
    ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
    signal: request.signal,
    endpoint: `${EXA_API_ORIGIN}${EXA_CONTENTS_PATH}`,
    header: EXA_AUTHORIZATION_HEADER,
    toHeaderValue: (apiKey) => `${EXA_BEARER_PREFIX}${apiKey}`,
    body: exaContentsBody({
      urls: request.urls,
      query: request.query,
      textMaxCharacters: request.maxTextCharacters,
      excerptMaxCharacters: request.excerptMaxCharacters,
    }),
    maxResponseBytes: request.maxResponseBytes,
    parse: (value) => parseExaContentsResponse(value, retrievedAt),
  })
  return response
}
