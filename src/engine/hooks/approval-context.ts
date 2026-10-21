import type { LLMMessage } from '@/core/llm'
import type { CallApprovalContext, Capability, ToolDefinition } from '@/core/tool'
import type { RunState, RunView } from '@/engine/types/run'
import { withoutPastedContent } from '@/core/security/pasted-content'
import { unwrapToolResult } from '@/core/security/sanitize'
import { textOf, toolCallsOf } from '@/core/utils/message'

// A network tool's result is the outside world's text; any other tool's can echo what the model
// wrote into its own arguments.
const SOURCE_CAPABILITY: Capability = 'net'

// Per-run counts, keyed on the run's own RunState so they are collected with the run.
const callCounts = new WeakMap<RunState, Map<string, number>>()

/** Counts this call, so build it once per call and only for a tool that reads it. */
export function approvalContextFor(run: RunView, toolName: string): CallApprovalContext {
  const counts = callCounts.get(run.state) ?? new Map<string, number>()
  const callCount = (counts.get(toolName) ?? 0) + 1
  let sourceText: string | undefined

  counts.set(toolName, callCount)
  callCounts.set(run.state, counts)

  return {
    config: run.env.config,
    callCount,
    hasSeen(text): boolean {
      sourceText ??= sourceTextOf(run.state.messages.history, run.env.tools)

      return sourceText.includes(text)
    },
  }
}

function sourceTextOf(history: readonly LLMMessage[], tools: readonly ToolDefinition[]): string {
  const networkTools = new Set(
    tools.filter((tool) => tool.capability === SOURCE_CAPABILITY).map((tool) => tool.name)
  )
  const networkCallIds = new Set(
    history
      .flatMap((message) => toolCallsOf(message))
      .filter((call) => networkTools.has(call.name))
      .map((call) => call.id)
  )

  return history.map((message) => sourceOf(message, networkCallIds)).join('\n')
}

function sourceOf(message: LLMMessage, networkCallIds: ReadonlySet<string>): string {
  if (message.role === 'user') {
    return withoutPastedContent(textOf(message.content))
  }

  const isNetworkResult =
    message.role === 'tool' &&
    message.isError !== true &&
    message.toolCallId !== undefined &&
    networkCallIds.has(message.toolCallId)

  return isNetworkResult ? unwrapToolResult(textOf(message.content)) : ''
}
