import type { ChainEntry } from '@/ai/types'
import type { LLMMessage, LLMRequest, ReasoningTextProtocol } from '@/core/llm'
import {
  acceptsJsonSchema,
  canEnforceContract,
  toOpenAiStrictSubset,
} from '@/ai/adapters/openai/strict-schema'

type WireMessage = Record<string, unknown>
type ReplayProtocol = ChainEntry['reasoningResolution']['replay']

const TEXT_REPLAY_PROTOCOLS: ReadonlySet<ReplayProtocol> = new Set<ReasoningTextProtocol>([
  'deepseek',
  'glm',
  'kimi',
  'ollama',
  'openrouter',
  'qwen',
])
// A thinking DeepSeek or Kimi model refuses a tool turn without reasoning, as one replayed from
// another model is; a blank keeps the turn valid.
const REASONING_REQUIRED_PROTOCOLS: ReadonlySet<ReplayProtocol> = new Set(['deepseek', 'kimi'])
const BLANK_REASONING = ' '

export function applyAssistantReasoningReplay(
  wire: WireMessage,
  message: LLMMessage,
  replay: ReplayProtocol
): void {
  if (replay === 'openrouter') {
    const details = (message.reasoningBlocks ?? [])
      .filter((block) => block.type === 'openrouter_reasoning_detail')
      .map((block) => block.detail)

    if (details.length > 0) {
      wire.reasoning_details = details
      return
    }
  }

  if (!isTextReplayProtocol(replay)) {
    return
  }

  const parts: string[] = []

  for (const block of message.reasoningBlocks ?? []) {
    if (block.type === 'reasoning_text' && block.protocol === replay) {
      parts.push(block.text)
    }
  }

  if (parts.length > 0) {
    wire[replay === 'openrouter' ? 'reasoning' : 'reasoning_content'] = parts.join('')
  } else if (REASONING_REQUIRED_PROTOCOLS.has(replay)) {
    wire.reasoning_content = BLANK_REASONING
  }
}

export function applyOpenAiOutputContract(
  body: WireMessage,
  req: LLMRequest,
  entry: ChainEntry
): void {
  const contract = req.outputContract

  if (contract === undefined || !canEnforceContract(req, entry.provider.id)) {
    return
  }

  if (entry.provider.id === 'openrouter') {
    // Unadvertised models, and every model when the capability fetch failed, keep the local
    // parser and correction path rather than a request the endpoint would reject.
    if (entry.structuredOutputs !== true) {
      entry.logger.warn('ai.structured_output_unenforced', {
        provider: entry.provider.id,
        model: entry.model,
        contract: contract.name,
      })
      return
    }

    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: contract.name,
        schema: toOpenAiStrictSubset(contract.schema),
        strict: true,
      },
    }
    // Merged, not replaced: chat.ts already put the entry's routing here, and a contract that
    // overwrote it would drop every `provider_only`/`sort` the operator configured.
    body.provider = { ...(body.provider as WireMessage | undefined), require_parameters: true }
    return
  }

  if (!acceptsJsonSchema(entry.provider.id)) {
    body.response_format = { type: 'json_object' }
  }
}

function isTextReplayProtocol(replay: ReplayProtocol): replay is ReasoningTextProtocol {
  return TEXT_REPLAY_PROTOCOLS.has(replay)
}
