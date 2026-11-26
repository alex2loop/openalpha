import type { LLMMessage } from '@/core/llm'
import type { CallApprovalContext, Capability, ToolDefinition } from '@/core/tool'
import type { RunState, RunView } from '@/engine/types/run'
import { withoutPastedContent } from '@/core/security/pasted-content'
import { unwrapToolResult } from '@/core/security/sanitize'
import { textOf, toolCallsOf } from '@/core/utils/message'
import { isEngineWrittenMessage } from '@/engine/compact/compactor'

// A built-in network tool's result is the outside world's text; any other tool's can echo what the
// model wrote into its own arguments, and an external tool's or a stranger's text is not the
// operator's reading.
const SOURCE_CAPABILITY: Capability = 'net'

// The operator writes `vnexpress.net/abc`; the model fetches `https://vnexpress.net/abc/`. A URL
// counts as seen only when a whole token of the source text matches it once both lose the
// scheme and the trailing slash and read the host in lower case (a path is case-sensitive), so a
// prefix of a seen URL never does. A source token keeps its parentheses, commas and semicolons
// (`/wiki/Apple_(company)`); the prose around it is trimmed off the token's edges instead, never
// off the URL the model asks for.
const URL_TOKEN_RE = /[^\s<>"'`[\]{}]+/g
const SCHEME_RE = /^https?:\/\//i
const HOST_RE = /^[^/?#]*/
const TRAILING_CHARS = '/.:!?'
const TRAILING_RE = new RegExp(`[${TRAILING_CHARS}]+$`)
const PROSE_OPENING_RE = /^\(+/
const PROSE_CLOSING_CHARS: ReadonlySet<string> = new Set([...TRAILING_CHARS, ',', ';'])

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
      // A tool's own earlier results never vouch for its next call: a fetched page listing links
      // would otherwise let the model walk it, or pick among them to signal what it read.
      seenTokens ??= tokensOf(
        sourceTextOf(
          run.state.messages.history,
          run.env.tools.filter((tool) => tool.name !== toolName),
          run.env.callDepth > 0
        )
      )

      return seenTokens.has(normalizeToken(text))
    },
  }
}

function tokensOf(sourceText: string): ReadonlySet<string> {
  return new Set(
    (sourceText.match(URL_TOKEN_RE) ?? []).map((token) => normalizeToken(trimProse(token)))
  )
}

function normalizeToken(token: string): string {
  return token
    .replace(SCHEME_RE, '')
    .replace(TRAILING_RE, '')
    .replace(HOST_RE, (host) => host.toLowerCase())
}

/** Drops the parentheses and punctuation prose puts around a URL, keeping a closing parenthesis
 *  the URL opened itself, so `(see https://x.com/a_(b)).` reads as the URL alone. */
function trimProse(text: string): string {
  const token = text.replace(PROSE_OPENING_RE, '')
  let unopened = countOf(token, ')') - countOf(token, '(')
  let end = token.length

  while (end > 0) {
    const last = token.charAt(end - 1)

    if (last === ')' && unopened > 0) {
      unopened -= 1
    } else if (!PROSE_CLOSING_CHARS.has(last)) {
      break
    }

    end -= 1
  }

  return token.slice(0, end)
}

function countOf(text: string, char: string): number {
  return text.split(char).length - 1
}

// A delegated child's user message is the parent model's prompt, not the operator's text.
function sourceTextOf(
  history: readonly LLMMessage[],
  tools: readonly ToolDefinition[],
  delegated: boolean
): string {
  const networkTools = new Set(tools.filter(isVouchingTool).map((tool) => tool.name))
  const networkCallIds = new Set(
    history
      .flatMap((message) => toolCallsOf(message))
      .filter((call) => networkTools.has(call.name))
      .map((call) => call.id)
  )

  return history.map((message) => sourceOf(message, networkCallIds, delegated)).join('\n')
}

function isVouchingTool(tool: ToolDefinition): boolean {
  return (
    tool.capability === SOURCE_CAPABILITY &&
    tool.isExternal !== true &&
    tool.thirdPartyOutput !== true
  )
}

function sourceOf(
  message: LLMMessage,
  networkCallIds: ReadonlySet<string>,
  delegated: boolean
): string {
  if (message.role === 'user') {
    // An engine-written recap or checklist is model prose and can restate a fetched page's URL.
    return delegated || isEngineWrittenMessage(message)
      ? ''
      : withoutPastedContent(textOf(message.content))
  }

  const isNetworkResult =
    message.role === 'tool' &&
    message.isError !== true &&
    message.toolCallId !== undefined &&
    networkCallIds.has(message.toolCallId)

  return isNetworkResult ? unwrapToolResult(textOf(message.content)) : ''
}
