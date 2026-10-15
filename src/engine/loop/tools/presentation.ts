import type { Logger } from '@/core/logging/logger'
import type { DisplayText } from '@/core/stream-events'
import type { ToolDefinition, ToolResult } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { ResolvedToolPresentation } from '@/engine/types/presentation'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { unwrapToolResult } from '@/core/security/sanitize'
import { toSingleLine } from '@/core/utils/text'

const TOOL_LABEL_MAX_LENGTH = 64
export const TOOL_DETAIL_MAX_LENGTH = 400
const MCP_NAME_PREFIX = 'mcp__'
const MCP_NAME_SEPARATOR = '__'

const WHITESPACE_RE = /\s+/
const QUOTED_ELEMENT_RE = /[\s"']/
const UNDERSCORE_RE = /_/g

interface ResolveToolResultDisplayInput {
  readonly tool: ToolDefinition
  readonly result: ToolResult
  readonly logger: Logger
}

export function resolveToolPresentation(
  tool: ToolDefinition,
  input: unknown,
  locale: Locale
): ResolvedToolPresentation {
  const declared = tool.presentation
  const label = declared?.label ?? humanizeToolName(tool.name)
  const detail = resolveDetail(tool, input, locale)
  const truncated = tool.isExternal === true && !isDetailComplete(detail)

  return {
    label: sanitizeText(label, TOOL_LABEL_MAX_LENGTH),
    lifecycleOwner: declared?.lifecycleOwner ?? 'tool',
    ...(declared?.emoji === undefined ? {} : { emoji: sanitizeText(declared.emoji, 8) }),
    ...(detail === undefined ? {} : { detail: sanitizeText(detail, TOOL_DETAIL_MAX_LENGTH) }),
    ...(truncated ? { truncated: true as const } : {}),
  }
}

// A tool that renders its own arguments answers first; `detailKeys` prints the ones plain enough
// to show as they are. An external tool declares neither and still reaches the approval gate.
function resolveDetail(tool: ToolDefinition, input: unknown, locale: Locale): string | undefined {
  const declared = tool.presentation

  if (declared?.detail !== undefined) {
    return declared.detail(input, locale)
  }

  if (declared?.detailKeys !== undefined) {
    return pickDetail(input, declared.detailKeys)
  }

  return tool.isExternal === true ? summarizeInput(input) : undefined
}

// `k=v` in declaration order. A nested value prints as compact JSON: skipping it would let the
// operator approve a payload they never saw.
function summarizeInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }

  const parts: string[] = []

  for (const [key, value] of Object.entries(input)) {
    const text = renderDetailValue(value)

    if (text !== undefined) {
      parts.push(`${key}=${text}`)
    }
  }

  return parts.length === 0 ? undefined : parts.join(' ')
}

/** Whether the detail a call would print fits whole. An approval prompt that cut it would hide the
 *  tail of what the operator is approving. */
export function isToolDetailComplete(input: unknown, keys: readonly string[]): boolean {
  return isDetailComplete(pickDetail(input, keys))
}

function isDetailComplete(detail: string | undefined): boolean {
  return detail === undefined || normalizeText(detail).length <= TOOL_DETAIL_MAX_LENGTH
}

/** What a surface renders in place of raw arguments. */
type ToolCallDisplay = Omit<ResolvedToolPresentation, 'lifecycleOwner'>

export function toToolCallDisplay(presentation: ResolvedToolPresentation): ToolCallDisplay {
  return {
    label: presentation.label,
    ...(presentation.emoji === undefined ? {} : { emoji: presentation.emoji }),
    ...(presentation.detail === undefined ? {} : { detail: presentation.detail }),
    ...(presentation.truncated === true ? { truncated: true as const } : {}),
  }
}

export function resolveToolResultDisplay(
  input: ResolveToolResultDisplayInput
): DisplayText | undefined {
  try {
    return (
      input.result.display ??
      (input.result.isError
        ? undefined
        : input.tool.summarizeResult?.(unwrapToolResult(input.result.content)))
    )
  } catch (err: unknown) {
    input.logger.warn('engine.tool_summary_failed', { err: formatErrForLog(err) })
    return undefined
  }
}

function humanizeToolName(name: string): string {
  if (name.startsWith(MCP_NAME_PREFIX)) {
    const parts = name.slice(MCP_NAME_PREFIX.length).split(MCP_NAME_SEPARATOR)
    const toolPart = parts[1] ?? parts[0]

    return toolPart === undefined ? 'mcp tool' : humanizeSegment(toolPart)
  }

  return humanizeSegment(name)
}

function humanizeSegment(segment: string): string {
  const words = segment.replace(UNDERSCORE_RE, ' ').trim().split(WHITESPACE_RE)

  return words
    .map((word) => (word.length === 0 ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`))
    .join(' ')
}

// Detail joins every listed key in order, so a shell call displays `ls -la`, not just `ls`.
function pickDetail(input: unknown, keys: readonly string[]): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }

  // why-safe: the guard above admits only non-null objects, and every read below goes through
  // `renderDetailValue`, which treats any value — including a missing one — as unknown.
  const record = input as Record<string, unknown>
  const parts: string[] = []

  for (const key of keys) {
    const text = renderDetailValue(record[key])

    if (text !== undefined) {
      parts.push(text)
    }
  }

  return parts.length === 0 ? undefined : parts.join(' ')
}

function renderDetailValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && value.every(isDetailPrimitive)) {
    return value.length === 0 ? undefined : value.map(renderDetailElement).join(' ')
  }

  return JSON.stringify(value)
}

// Quoted when it holds whitespace or a quote, or nothing, so that `["a b"]` does not read as two
// arguments once the elements are joined.
function renderDetailElement(element: unknown): string {
  if (typeof element === 'string' && (element === '' || QUOTED_ELEMENT_RE.test(element))) {
    return JSON.stringify(element)
  }

  return String(element)
}

function isDetailPrimitive(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function sanitizeText(text: string, maxLength: number): string {
  const scrubbed = normalizeText(text)

  if (scrubbed.length <= maxLength) {
    return scrubbed
  }

  return `${scrubbed.slice(0, maxLength - 1)}…`
}

function normalizeText(text: string): string {
  return scrubCredentials(toSingleLine(text)).trim().replace(WHITESPACE_RE, ' ')
}
