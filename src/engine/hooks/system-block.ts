import type { LLMMessage, LLMRequest } from '@/core/llm'

const SYSTEM_BLOCK_SEPARATOR = '\n\n'

type StringSystemMessage = LLMMessage & {
  readonly role: 'system'
  readonly content: string
}

// v2 requests carry one system message rather than a systemBlocks array, so a modifier appends its
// block to that message instead of pushing onto a list.
export function appendVolatileSystemBlock(req: LLMRequest, text: string): LLMRequest {
  const head = req.messages[0]

  if (!isStringSystemMessage(head)) {
    return appendSystemBlock(req, text)
  }

  const prefixLength = head.content.length + SYSTEM_BLOCK_SEPARATOR.length
  const appended = appendSystemBlock(req, text)

  return {
    ...appended,
    systemCachePrefixLength: req.systemCachePrefixLength ?? prefixLength,
  }
}

export function appendSystemBlock(req: LLMRequest, text: string): LLMRequest {
  const [head, ...rest] = req.messages

  if (!isStringSystemMessage(head)) {
    const block: LLMMessage = { role: 'system', content: text }
    const { systemCachePrefixLength: _staleCachePrefix, ...request } = req

    return { ...request, messages: [block, ...req.messages] }
  }

  const merged: LLMMessage = {
    ...head,
    content: `${head.content}${SYSTEM_BLOCK_SEPARATOR}${text}`,
  }

  return { ...req, messages: [merged, ...rest] }
}

function isStringSystemMessage(message: LLMMessage | undefined): message is StringSystemMessage {
  return message?.role === 'system' && typeof message.content === 'string'
}
