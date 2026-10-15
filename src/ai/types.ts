import type { CredentialSource } from '@/ai/auth/types'
import type { ProviderEntry } from '@/ai/catalog'
import type { ReasoningResolution } from '@/ai/reasoning/resolve'
import type { LLMRequest, LLMResponse, ProviderRouting, ReasoningMode } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { OnStreamEvent } from '@/core/stream-events'

// One fallback-chain position: a catalog provider, the model to ask it for, and the credentials and
// endpoint resolved for it at boot. The chain never reads process.env.
export interface ChainEntry {
  readonly provider: ProviderEntry
  readonly model: string
  readonly apiKey: string
  // Bound for providers whose catalog authKind is oauth_subscription; those carry an empty apiKey.
  readonly credentials?: CredentialSource
  // The entry's `[[models]] base_url` override, else the catalog's.
  readonly baseUrl: string
  readonly logger: Logger
  // Per-entry `[[models]]` tuning: the chain overrides the request with these before the call.
  readonly reasoningMode: ReasoningMode
  readonly reasoningRequired?: boolean
  readonly providerRouting?: ProviderRouting
  readonly reasoningResolution: ReasoningResolution
  // Router-advertised JSON-schema enforcement; unset until the chain resolves it.
  readonly structuredOutputs?: boolean
  readonly maxTokens?: number
  readonly ttftTimeoutMs?: number
  readonly streamIdleTimeoutMs?: number
}

// `entry.model` is authoritative — the chain may be serving a different model than `req.model` named.
export interface Transport {
  stream(req: LLMRequest, entry: ChainEntry, onEvent: OnStreamEvent): Promise<LLMResponse>
}

export interface ModelPrice {
  readonly inPerM: number
  readonly outPerM: number
  readonly cacheReadPerM?: number
  readonly cacheWritePerM?: number
}
