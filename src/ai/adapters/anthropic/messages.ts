import type { ChainEntry, Transport } from '@/ai/types'
import type { LLMMessage, LLMRequest, ThinkingBlock } from '@/core/llm'
import type { ToolSchema } from '@/core/tool'
import { ANTHROPIC_TRANSPORT_NAME, anthropicRouter } from '@/ai/adapters/anthropic/stream'
import { EPHEMERAL_CACHE_CONTROL, toCachedTextBlocks } from '@/ai/adapters/cache-control'
import { keyedHeaders, resolveEndpointUrl, runStream } from '@/ai/adapters/runner'
import { contentBlocks, textOf } from '@/core/utils/message'

const ANTHROPIC_VERSION = '2023-06-01'

type WireMessage = Record<string, unknown>

export const anthropicTransport: Transport = {
  stream(req, entry, onEvent) {
    // Hosts serving the Anthropic wire format from another vendor (MiniMax) authenticate with a
    // bearer token, and reject thinking signatures minted by api.anthropic.com.
    const isThirdParty = entry.provider.authStyle === 'bearer'
    const headers: Record<string, string> = {
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...keyedHeaders(
        entry.apiKey,
        isThirdParty ? { authorization: `Bearer ${entry.apiKey}` } : { 'x-api-key': entry.apiKey }
      ),
    }

    return runStream({
      url: resolveEndpointUrl(entry.baseUrl, 'v1/messages'),
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody(req, entry, isThirdParty)),
        signal: req.signal,
      },
      router: anthropicRouter(entry.logger),
      onEvent,
      logger: entry.logger,
      transportName: ANTHROPIC_TRANSPORT_NAME,
      maxTokens: req.maxTokens,
      messages: req.messages,
    })
  },
}

function buildBody(req: LLMRequest, entry: ChainEntry, stripSignatures: boolean): WireMessage {
  const { system, messages } = toWireMessages(
    req.messages,
    stripSignatures,
    req.systemCachePrefixLength
  )
  const tools = toWireTools(req.tools)
  const body: WireMessage = {
    model: entry.model,
    max_tokens: req.maxTokens,
    messages,
    stream: true,
  }

  if (system.length > 0) {
    body.system = system
  }

  if (tools && entry.provider.supportsTools) {
    body.tools = tools
  }

  Object.assign(body, entry.reasoningResolution.request)
  return body
}

function toWireMessages(
  messages: readonly LLMMessage[],
  stripSignatures: boolean,
  systemCachePrefixLength?: number
): { readonly system: readonly WireMessage[]; readonly messages: readonly WireMessage[] } {
  const system: WireMessage[] = []
  const out: WireMessage[] = []
  const cacheBoundaryMessageIndex = firstCacheBoundaryMessageIndex(
    messages,
    systemCachePrefixLength
  )

  for (const [index, message] of messages.entries()) {
    if (message.role === 'system') {
      const cachePrefixLength =
        index === cacheBoundaryMessageIndex ? systemCachePrefixLength : undefined

      system.push(...toSystemBlocks(message, cachePrefixLength))
    } else if (message.role === 'tool') {
      out.push(toolResultMessage(message))
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: assistantBlocks(message, stripSignatures),
      })
    } else {
      out.push({ role: 'user', content: textOf(message.content, '\n') })
    }
  }

  if (!system.some((block) => block.cache_control !== undefined)) {
    markLastSystemCached(system)
  }

  markLastToolResultCached(out)

  return { system, messages: out }
}

function firstCacheBoundaryMessageIndex(
  messages: readonly LLMMessage[],
  cachePrefixLength?: number
): number {
  if (cachePrefixLength === undefined) {
    return -1
  }

  return messages.findIndex(
    (message) => message.role === 'system' && typeof message.content === 'string'
  )
}

function toSystemBlocks(message: LLMMessage, cachePrefixLength?: number): readonly WireMessage[] {
  const text = textOf(message.content, '\n')

  return toCachedTextBlocks(text, cachePrefixLength) ?? [{ type: 'text', text }]
}

function markLastSystemCached(system: readonly WireMessage[]): void {
  const lastSystem = system.at(-1)

  if (lastSystem !== undefined) {
    lastSystem.cache_control = EPHEMERAL_CACHE_CONTROL
  }
}

function toolResultMessage(message: LLMMessage): WireMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: textOf(message.content, '\n'),
        ...(message.isError === true ? { is_error: true } : {}),
      },
    ],
  }
}

function assistantBlocks(message: LLMMessage, stripSignatures: boolean): unknown {
  const blocks: WireMessage[] = []

  for (const block of message.reasoningBlocks ?? []) {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      pushThinkingBlock(blocks, block, stripSignatures)
    }
  }

  for (const block of contentBlocks(message.content)) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text })
    } else {
      const { id, name, input } = block.call
      blocks.push({ type: 'tool_use', id, name, input })
    }
  }

  return blocks.length > 0 ? blocks : message.content
}

// A thinking block replayed without its signature is rejected; one replayed with a signature the
// host cannot verify is also rejected. Third-party hosts get the text only, redacted blocks dropped.
function pushThinkingBlock(
  blocks: WireMessage[],
  block: ThinkingBlock,
  stripSignatures: boolean
): void {
  if (block.type === 'redacted_thinking') {
    if (!stripSignatures) {
      blocks.push({ type: 'redacted_thinking', data: block.data })
    }

    return
  }

  const wire: WireMessage = { type: 'thinking', thinking: block.thinking }

  if (block.signature !== undefined && !stripSignatures) {
    wire.signature = block.signature
  }

  blocks.push(wire)
}

// Cache the prefix up to the newest tool result: that boundary is stable across the next turn,
// so the whole conversation before it reads from cache instead of being re-billed as input.
function markLastToolResultCached(messages: readonly WireMessage[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content

    if (!Array.isArray(content)) {
      continue
    }

    for (let j = content.length - 1; j >= 0; j--) {
      const block: unknown = content[j]

      if (isToolResultBlock(block)) {
        block.cache_control = EPHEMERAL_CACHE_CONTROL
        return
      }
    }
  }
}

function isToolResultBlock(block: unknown): block is WireMessage {
  return (
    typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result'
  )
}

function toWireTools(tools: readonly ToolSchema[] | undefined): readonly WireMessage[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    ...(tool.examples === undefined ? {} : { input_examples: tool.examples }),
  }))
}
