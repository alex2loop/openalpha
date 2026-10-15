import type { ContentBlock, LLMMessage } from '@/core/llm'
import type { ToolCall } from '@/core/tool'

export function contentBlocks(content: LLMMessage['content']): readonly ContentBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

// Adapters join distinct blocks as lines; the engine reassembles one streamed reply.
export function textOf(content: LLMMessage['content'], separator = ''): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(separator)
}

export function toolCallIdsOf(message: LLMMessage | undefined): readonly string[] {
  if (message?.role !== 'assistant') {
    return []
  }

  return toolCallsOf(message).map((call) => call.id)
}

export function toolCallsOf(message: LLMMessage): readonly ToolCall[] {
  if (typeof message.content === 'string') {
    return []
  }

  return message.content.filter((block) => block.type === 'tool_call').map((block) => block.call)
}

// Compaction, a halted run, or a trim can leave one half of a tool call/result pair behind, and a
// provider rejects the orphan. Strips orphan tool_call blocks block-by-block so text and matched
// siblings survive; the message is dropped only when filtering leaves it with no content at all.
export function repairToolPairs(messages: readonly LLMMessage[]): LLMMessage[] {
  const answered = collectResultIds(messages)
  const withoutOrphanCalls = messages.flatMap((message) => dropOrphanCalls(message, answered))
  const surviving = new Set<string>()

  for (const message of withoutOrphanCalls) {
    for (const id of toolCallIdsOf(message)) {
      surviving.add(id)
    }
  }

  return withoutOrphanCalls.filter(
    (message) =>
      message.role !== 'tool' ||
      message.toolCallId === undefined ||
      surviving.has(message.toolCallId)
  )
}

function dropOrphanCalls(message: LLMMessage, answered: ReadonlySet<string>): LLMMessage[] {
  if (message.role !== 'assistant' || typeof message.content === 'string') {
    return [message]
  }

  const kept = message.content.filter(
    (block) => block.type !== 'tool_call' || answered.has(block.call.id)
  )

  if (kept.length === message.content.length) {
    return [message]
  }

  if (kept.length === 0) {
    return []
  }

  return [{ ...message, content: kept }]
}

function collectResultIds(messages: readonly LLMMessage[]): ReadonlySet<string> {
  const ids = new Set<string>()

  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      ids.add(message.toolCallId)
    }
  }

  return ids
}
