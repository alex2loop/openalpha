import type { ContentBlock, LLMMessage } from '@/core/llm'
import type { AfterToolHook } from '@/engine/types/run'
import { CHARS_PER_TOKEN } from '@/core/stream-events'
import { hashString } from '@/core/utils/hash'

const TOOL_TRIM_RATIO = 0.075
const DEDUP_MIN_BYTES = 200
const TOOL_ARGS_TRIM_BYTES = 500
const TRUNCATE_MARKER = '...[truncated]'

// afterTool: keep the live history from bloating on tool output. Three passes, cheapest first, and
// the whole history is only rewritten when something actually changed.
export const trimResultsHook: AfterToolHook = async (run) => {
  const history = run.state.messages.history

  if (history.length === 0) {
    return
  }

  const trimmed = fastTrim(history, run.env.limits.contextWindow)

  if (trimmed !== undefined) {
    run.state.messages.replaceAll(trimmed)
  }
}

function fastTrim(
  msgs: readonly LLMMessage[],
  contextWindow: number
): readonly LLMMessage[] | undefined {
  // contextWindow is a token count; the cap below is a character length, so convert with the same
  // ratio the estimator uses (engine/loop/limits.ts) rather than applying token units as characters.
  const capChars = Math.floor(contextWindow * TOOL_TRIM_RATIO * CHARS_PER_TOKEN)
  const capped = capToolResults(msgs, capChars)
  const deduped = dedupByContentHash(capped.msgs)
  const shrunk = truncateOversizeArgs(deduped.msgs)

  if (!(capped.changed || deduped.changed || shrunk.changed)) {
    return undefined
  }

  return shrunk.msgs
}

interface TrimPass {
  readonly msgs: readonly LLMMessage[]
  readonly changed: boolean
}

function capToolResults(msgs: readonly LLMMessage[], cap: number): TrimPass {
  let changed = false

  const out = msgs.map((msg) => {
    if (msg.role !== 'tool' || typeof msg.content !== 'string' || msg.content.length <= cap) {
      return msg
    }

    changed = true

    return { ...msg, content: capContent(msg.content, cap) }
  })

  return { msgs: out, changed }
}

// Head+tail window: a truncated result usually carries its signal at both ends, not the middle.
function capContent(content: string, cap: number): string {
  const half = Math.floor((cap - TRUNCATE_MARKER.length) / 2)

  return `${content.slice(0, half)}${TRUNCATE_MARKER}${content.slice(-half)}`
}

// A tool re-called with the same args returns the same bytes; keep one copy and point at it.
function dedupByContentHash(msgs: readonly LLMMessage[]): TrimPass {
  const seen = new Map<string, string>()
  let changed = false

  const out = msgs.map((msg) => {
    if (msg.role !== 'tool') {
      return msg
    }

    const content = serializeContent(msg)

    if (content.length < DEDUP_MIN_BYTES) {
      return msg
    }

    const hash = hashString(content)
    const previous = seen.get(hash)

    if (previous !== undefined) {
      changed = true

      return { ...msg, content: `[duplicate of toolcall_${previous}]` }
    }

    seen.set(hash, msg.toolCallId ?? 'unknown')

    return msg
  })

  return { msgs: out, changed }
}

function truncateOversizeArgs(msgs: readonly LLMMessage[]): TrimPass {
  let changed = false

  const out = msgs.map((msg) => {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') {
      return msg
    }

    const blocks = msg.content.map(truncateBlock)

    if (blocks.every((block, i) => block === msg.content[i])) {
      return msg
    }

    changed = true

    return { ...msg, content: blocks }
  })

  return { msgs: out, changed }
}

function truncateBlock(block: ContentBlock): ContentBlock {
  if (block.type !== 'tool_call') {
    return block
  }

  const serialized = JSON.stringify(block.call.input)

  if (serialized.length <= TOOL_ARGS_TRIM_BYTES) {
    return block
  }

  return {
    ...block,
    call: { ...block.call, input: { _truncated: serialized.slice(0, TOOL_ARGS_TRIM_BYTES) } },
  }
}

function serializeContent(msg: LLMMessage): string {
  return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
}
