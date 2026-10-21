import type { ContentBlock, LLMMessage, LLMRequest } from '@/core/llm'
import type { CostReservation } from '@/engine/types/cost'
import type { RunView } from '@/engine/types/run'
import { CHARS_PER_TOKEN, weightedCharCount } from '@/core/stream-events'
import { reserveRequiredLlmCost } from '@/engine/budget/reservation'

export function estimateTokens(messages: readonly LLMMessage[]): number {
  let chars = 0

  for (const message of messages) {
    chars += messageCharCount(message)
  }

  return Math.floor(chars / CHARS_PER_TOKEN)
}

// The normal turn's admission: the ceiling spans every chain entry (a cheap primary can fall
// back to an expensive one), then the shared reservation path enforces run/global budgets. A
// one-shot's first turn lands before the live feed does, and priced at the fallback rate it can
// overrun a small daily cap on its own.
export async function reserveTurnCost(run: RunView, request: LLMRequest): Promise<CostReservation> {
  await run.services.pricing.ready()

  const inputTokens = estimateTokens(request.messages) + estimateToolTokens(request.tools)

  const estimate = run.services.chain.estimateMaxCost({
    requestedModel: request.model,
    inputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    maxTokens: request.maxTokens,
    reasoningMode: request.reasoningMode,
    hasOutputContract: request.outputContract !== undefined,
  })

  return reserveRequiredLlmCost(run, estimate)
}

function estimateToolTokens(tools: LLMRequest['tools']): number {
  if (tools === undefined || tools.length === 0) {
    return 0
  }

  const serialized = JSON.stringify(tools)

  return Math.ceil(weightedCharCount(serialized) / CHARS_PER_TOKEN)
}

function messageCharCount(message: LLMMessage): number {
  let chars = typeof message.content === 'string' ? weightedCharCount(message.content) : 0

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      chars += weightedCharCount(blockText(block))
    }
  }

  if (message.reasoningBlocks !== undefined) {
    for (const block of message.reasoningBlocks) {
      chars += weightedCharCount(JSON.stringify(block))
    }
  }

  return chars
}

function blockText(block: ContentBlock): string {
  if (block.type === 'text') {
    return block.text
  }

  return JSON.stringify(block.call.input) ?? ''
}
