import type { ChainEntry } from '@/ai/types'
import type { LLMRequest } from '@/core/llm'
import { EPHEMERAL_CACHE_CONTROL, toCachedTextBlocks } from '@/ai/adapters/cache-control'
import { toWireProviderRouting } from '@/ai/adapters/openai/openrouter-routing'

// OpenRouter caches a Claude prompt only where the request marks a breakpoint; the other models it
// serves cache on their own.
const CLAUDE_MODEL_RE = /(?:^|\/)claude-/i

type WireMessage = Record<string, unknown>

interface OpenRouterRequest {
  readonly req: LLMRequest
  readonly entry: ChainEntry
  readonly messages: readonly WireMessage[]
}

export function applyOpenRouterRequest(body: WireMessage, request: OpenRouterRequest): void {
  const { req, entry, messages } = request
  body.usage = { include: true }

  if (req.routingKey !== undefined) {
    body.session_id = req.routingKey
  }

  if (entry.providerRouting !== undefined) {
    body.provider = toWireProviderRouting(entry.providerRouting)
  }

  if (CLAUDE_MODEL_RE.test(entry.model)) {
    markSystemCached(messages, req.systemCachePrefixLength)
  }
}

// `systemCachePrefixLength` measures the first system message. With no usable prefix, the whole
// message is the breakpoint, as the Anthropic transport does.
function markSystemCached(messages: readonly WireMessage[], cachePrefixLength?: number): void {
  const system = messages.find((message) => message.role === 'system')
  const text = system?.content

  if (system === undefined || typeof text !== 'string') {
    return
  }

  system.content = toCachedTextBlocks(text, cachePrefixLength) ?? [
    { type: 'text', text, cache_control: EPHEMERAL_CACHE_CONTROL },
  ]
}
