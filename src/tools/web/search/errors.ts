import type { ToolErrorCode } from '@/core/errors'
import type { ResearchProviderFailureCode } from '@/engine/api'
import { ToolError } from '@/core/errors'

export const SEARCH_RETRY_AFTER_MAX_MS = 60_000
const ZERO_PROVIDER_COST_USD = 0

const SEARCH_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])

export function isSearchRetryableStatus(status: number): boolean {
  return SEARCH_RETRYABLE_STATUS_CODES.has(status)
}

export class SearchRetryableError extends ToolError {
  readonly retryAfterMs: number
  readonly failureCode: Extract<
    ResearchProviderFailureCode,
    'rate_limited' | 'timeout' | 'transport'
  >

  constructor(
    message: string,
    options: {
      readonly retryAfterMs: number
      readonly failureCode?: Extract<
        ResearchProviderFailureCode,
        'rate_limited' | 'timeout' | 'transport'
      >
      readonly code?: ToolErrorCode
    }
  ) {
    super(options.code ?? 'unexpected', message)
    this.retryAfterMs = Math.min(SEARCH_RETRY_AFTER_MAX_MS, Math.max(0, options.retryAfterMs))
    this.failureCode = options.failureCode ?? 'transport'
  }
}

export class SearchProviderError extends ToolError {
  readonly costUsd: number

  constructor(
    readonly failureCode: ResearchProviderFailureCode,
    message: string,
    options?: {
      readonly costUsd?: number
      readonly retryAfterMs?: number
      readonly cause?: unknown
    }
  ) {
    super('unexpected', message, options?.cause)
    this.costUsd = options?.costUsd ?? ZERO_PROVIDER_COST_USD
    this.retryAfterMs = options?.retryAfterMs ?? 0
  }

  readonly retryAfterMs: number
}
