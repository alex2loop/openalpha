import type { LLMMessage } from '@/core/llm'
import type { CallApprovalContext, Capability, ToolDefinition } from '@/core/tool'
import type { RunState, RunView } from '@/engine/types/run'
import { withoutPastedContent } from '@/core/security/pasted-content'
import { unwrapToolResult } from '@/core/security/sanitize'
import { textOf, toolCallsOf } from '@/core/utils/message'

// A network tool's result is the outside world's text; any other tool's can echo what the model
// wrote into its own arguments.
const SOURCE_CAPABILITY: Capability = 'net'

// The operator writes `vnexpress.net/abc`; the model fetches `https://vnexpress.net/abc/`. A URL
// counts as seen only when a whole token of the source text matches it once both lose the
// scheme and the trailing slash, so a prefix of a seen URL never does.
const URL_TOKEN_RE = /[^\s<>"'`()[\]{},;]+/g
const SCHEME_RE = /^https?:\/\//
const TRAILING_RE = /[/.:!?]+$/

// Per-run counts, keyed on the run's own RunState so they are collected with the run.
const callCounts = new WeakMap<RunState, Map<string, number>>()

/** Counts this call, so build it once per call and only for a tool that reads it. */
export function approvalContextFor(run: RunView, toolName: string): CallApprovalContext {
  const counts = callCounts.get(run.state) ?? new Map<string, number>()
  const callCount = (counts.get(toolName) ?? 0) + 1
  let seenTokens: ReadonlySet<string> | undefined

  counts.set(toolName, callCount)
  callCounts.set(run.state, counts)

  return {
    config: run.env.config,
    callCount,
    hasSeen(text): boolean {
      seenTokens ??= tokensOf(
        sourceTextOf(run.state.messages.history, run.env.tools, run.env.callDepth > 0)
      )

      return seenTokens.has(normalizeToken(text))
    },
  }
}

function tokensOf(sourceText: string): ReadonlySet<string> {
  return new Set((sourceText.match(URL_TOKEN_RE) ?? []).map(normalizeToken))
}

function normalizeToken(token: string): string {
  return token.replace(SCHEME_RE, '').replace(TRAILING_RE, '')
}

// A delegated child's user message is the parent model's prompt, not the operator's text.
function sourceTextOf(
  history: readonly LLMMessage[],
  tools: readonly ToolDefinition[],
  delegated: boolean
): string {
  const networkTools = new Set(
    tools.filter((tool) => tool.capability === SOURCE_CAPABILITY).map((tool) => tool.name)
  )
  const networkCallIds = new Set(
    history
      .flatMap((message) => toolCallsOf(message))
      .filter((call) => networkTools.has(call.name))
      .map((call) => call.id)
  )

  return history.map((message) => sourceOf(message, networkCallIds, delegated)).join('\n')
}

function sourceOf(
  message: LLMMessage,
  networkCallIds: ReadonlySet<string>,
  delegated: boolean
): string {
  if (message.role === 'user') {
    return delegated ? '' : withoutPastedContent(textOf(message.content))
  }

  const isNetworkResult =
    message.role === 'tool' &&
    message.isError !== true &&
    message.toolCallId !== undefined &&
    networkCallIds.has(message.toolCallId)

  return isNetworkResult ? unwrapToolResult(textOf(message.content)) : ''
}
