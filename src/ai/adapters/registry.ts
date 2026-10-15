import type { TransportKind } from '@/ai/catalog'
import type { Transport } from '@/ai/types'
import { anthropicTransport } from '@/ai/adapters/anthropic/messages'
import { geminiTransport } from '@/ai/adapters/gemini'
import { openaiTransport } from '@/ai/adapters/openai/chat'
import { openaiResponsesTransport } from '@/ai/adapters/openai/responses'
import { openrouterDecisionsTransport } from '@/ai/adapters/openrouter/decisions'

export const TRANSPORTS: Readonly<Record<TransportKind, Transport>> = {
  anthropic_messages: anthropicTransport,
  openai_chat: openaiTransport,
  openai_responses: openaiResponsesTransport,
  gemini_generate: geminiTransport,
  openrouter_decisions: openrouterDecisionsTransport,
}
