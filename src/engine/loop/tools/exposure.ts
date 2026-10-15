import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import type { ToolDefinition, ToolResult, ToolSchema } from '@/core/tool'
import type { RankedTool } from '@/engine/loop/tools/tool-ranking'
import type { ResolvedToolPresentation } from '@/engine/types/presentation'
import type { ToolExposure, ToolGate, ToolGateResult } from '@/engine/types/run'
import { ConfigError, ToolError, type ToolErrorCode } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { toToolParameters, toToolSchema } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'
import { coerceToolArgs } from '@/engine/loop/executor'
import { rankTools } from '@/engine/loop/tools/tool-ranking'

export const TOOL_SEARCH_NAME = 'tool_search'
export const TOOL_SEARCH_PRESENTATION: ResolvedToolPresentation = {
  label: 'Tool search',
  lifecycleOwner: 'tool',
  emoji: '🧰',
}
const DIRECT_TOOL_SCHEMA_LIMIT = 10
// The eager set covers tools the model does not know it needs — it will not search for arithmetic,
// the current date, or its own ability to schedule — plus the flagship tools the chat prompt routes
// to by name, which must be schema-visible to be chosen. The exposed ceiling stays this plus the
// search working set. Raising this is a prompt-budget decision: every eager tool ships its schema
// on every turn, so a new one earns its place by being unreachable through tool_search in practice
// — a market-data tool the prompt names is one, because a model that cannot see it asks the web,
// and so is the ledger write, which a model reports as a missing capability instead of searching.
// skill_view is the third kind: the <available_skills> block names it on every turn.
const MAX_EAGER_TOOL_COUNT = 23
/** Slots searched tools rotate through, oldest evicted first - not a per-run quota. */
const TOOL_SEARCH_WORKING_SET = 8
const HINT_CALL_NOW = 'Call it now.'
const HINT_PICK_ONE =
  'Call the one that fits; search again with a different capability word if none does.'
const HINT_NONE =
  'No tool matches. Answer from what you have, or search with a different capability word.'
const MAX_EXPOSED_TOOL_COUNT = MAX_EAGER_TOOL_COUNT + TOOL_SEARCH_WORKING_SET
const TOOL_SEARCH_QUERY_MAX_CHARS = 500
const TOOL_SEARCH_RESULT_LIMIT = 5
const QUERY_CONTENT_RE = /[\p{L}\p{N}]/u
const TOOL_SEARCH_INPUT_SCHEMA = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1)
    .max(TOOL_SEARCH_QUERY_MAX_CHARS)
    .regex(QUERY_CONTENT_RE, 'query must contain a letter or number')
    .describe('A short generic capability, not the details of the task.'),
})
const TOOL_SEARCH_SCHEMA: ToolSchema = {
  name: TOOL_SEARCH_NAME,
  description:
    'Searches the authorized tool catalog by capability and loads the best matches so they can be called on the next turn. Use it when a needed tool has no schema in this request. Returns the matches, which are now loaded, and a hint saying what to call next.',
  parameters: toToolParameters(TOOL_SEARCH_INPUT_SCHEMA),
}

export function toolSearchGist(content: string): DisplayText | undefined {
  try {
    const parsed: unknown = JSON.parse(content)

    if (!isPlainRecord(parsed)) {
      return undefined
    }

    const loaded = parsed.loaded
    const matches = parsed.matches

    if (Array.isArray(loaded) && loaded.length > 0) {
      return { key: 'toolSummaries.toolsNamed', params: { tools: namesOf(loaded) } }
    }

    if (Array.isArray(matches)) {
      return countGist(
        matches.length,
        'toolSummaries.toolSearchMatch',
        'toolSummaries.toolSearchMatches'
      )
    }
  } catch {
    // Malformed content — no gist.
    return undefined
  }

  return undefined
}

// `loaded` is a name list; a non-string entry is skipped rather than stringified into the line.
function namesOf(loaded: readonly unknown[]): string {
  return loaded.filter((entry) => typeof entry === 'string').join(', ')
}

function countGist(count: number, one: string, other: string): DisplayText {
  return { key: count === 1 ? one : other, params: { count } }
}

interface CatalogItem {
  readonly name: string
  readonly description: string
}

interface SearchToolsInput {
  readonly authorized: readonly ToolDefinition[]
  readonly exposed: Set<string>
  readonly eager: ReadonlySet<string>
  readonly isSearchEnabled: boolean
  readonly input: unknown
}

interface ExposeMatchesInput {
  readonly authorized: readonly ToolDefinition[]
  readonly exposed: Set<string>
  readonly eager: ReadonlySet<string>
  readonly matches: readonly RankedTool[]
  readonly hasMoreMatches: boolean
}

interface AdmitMatchesInput {
  readonly exposed: Set<string>
  readonly eager: ReadonlySet<string>
  readonly matches: readonly RankedTool[]
}

interface Admitted {
  readonly loaded: readonly string[]
  readonly evicted: readonly string[]
}

export function assertToolExposureRegistry(tools: ReadonlyMap<string, ToolDefinition>): void {
  if (tools.has(TOOL_SEARCH_NAME)) {
    throw new ConfigError(`tool name '${TOOL_SEARCH_NAME}' is reserved by the engine`)
  }

  const eagerCount = [...tools.values()].filter((tool) => tool.eager === true).length

  if (eagerCount > MAX_EAGER_TOOL_COUNT) {
    throw new ConfigError(
      `tool registry has ${eagerCount} eager tools; maximum is ${MAX_EAGER_TOOL_COUNT}`
    )
  }
}

export function createToolExposure(authorized: readonly ToolDefinition[]): ToolExposure {
  const isSearchEnabled = authorized.length > DIRECT_TOOL_SCHEMA_LIMIT
  const exposed = toInitialExposedNames(authorized, isSearchEnabled)
  const eager = toEagerNames(authorized)
  let isClosed = false

  return {
    toSchemas: () => (isClosed ? [] : toExposedSchemas(authorized, exposed, isSearchEnabled)),
    exposedNames: () => new Set(exposed),
    search: (input) => searchTools({ authorized, exposed, eager, isSearchEnabled, input }),
    close: () => {
      isClosed = true
    },
  }
}

// An exact name is intent, not a guess: the tool is loaded and the call runs. Only a call that had
// to be matched to related tools is blocked, because a `warn` verdict would run a tool the model
// was simultaneously told had only been loaded for a later call.
export function createToolExposureGate(exposure: ToolExposure): ToolGate {
  return async (_run, call): Promise<ToolGateResult> => {
    if (exposure.exposedNames().has(call.name)) {
      return { action: 'allow' }
    }

    const loaded = safeParseSearchResult(exposure.search({ query: call.name }))?.loaded ?? []

    if (loaded.length === 1 && loaded[0] === call.name) {
      return { action: 'allow' }
    }

    const error = createToolError(
      'unknown_tool',
      loaded.length > 0
        ? `Tool ${call.name} was not exposed. Related tools are now loaded: ${loaded.join(', ')}. Call one of them.`
        : `Tool ${call.name} is not exposed and no match was found; try ${TOOL_SEARCH_NAME} with a capability keyword`
    )

    return { action: 'block', message: error.message, error }
  }
}

interface SearchResultParsed {
  readonly loaded: readonly string[]
}

function safeParseSearchResult(result: ToolResult): SearchResultParsed | null {
  try {
    const parsed: unknown = JSON.parse(result.content)

    return isSearchResultParsed(parsed) ? parsed : null
  } catch {
    // Malformed search result — treat as no match.
    return null
  }
}

function isSearchResultParsed(value: unknown): value is SearchResultParsed {
  return (
    typeof value === 'object' &&
    value !== null &&
    'loaded' in value &&
    Array.isArray(value.loaded) &&
    value.loaded.every((name: unknown) => typeof name === 'string')
  )
}

function toInitialExposedNames(
  authorized: readonly ToolDefinition[],
  isSearchEnabled: boolean
): Set<string> {
  const names = new Set<string>()

  for (const tool of authorized) {
    if (!isSearchEnabled || tool.eager === true) {
      names.add(tool.name)
    }
  }

  return names
}

function toEagerNames(authorized: readonly ToolDefinition[]): ReadonlySet<string> {
  return new Set(authorized.filter((tool) => tool.eager === true).map((tool) => tool.name))
}

function toExposedSchemas(
  authorized: readonly ToolDefinition[],
  exposed: ReadonlySet<string>,
  isSearchEnabled: boolean
): readonly ToolSchema[] {
  const schemas = authorized
    .filter((tool) => exposed.has(tool.name))
    .map((tool) => toToolSchema(tool))

  return isSearchEnabled ? [...schemas, TOOL_SEARCH_SCHEMA] : schemas
}

function searchTools(input: SearchToolsInput): ToolResult {
  try {
    const { authorized, exposed, eager, isSearchEnabled } = input

    if (!isSearchEnabled) {
      return toolErrorResult(
        'unknown_tool',
        `${TOOL_SEARCH_NAME} is unavailable for this tool catalog`
      )
    }

    const parsed = TOOL_SEARCH_INPUT_SCHEMA.safeParse(coerceToolArgs(input.input))

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid tool search query'
      return toolErrorResult('invalid_input', message)
    }

    const ranked = rankTools(authorized, parsed.data.query)
    const available = ranked.filter(({ tool }) => !exposed.has(tool.name))
    const matches = available.slice(0, TOOL_SEARCH_RESULT_LIMIT)

    if (matches.length === 0) {
      if (ranked.length > 0) {
        return exposeMatches({
          authorized,
          exposed,
          eager,
          matches: ranked.slice(0, TOOL_SEARCH_RESULT_LIMIT),
          hasMoreMatches: false,
        })
      }

      return toolSuccessResult({
        loaded: [],
        available: authorized.map((tool) => tool.name),
        hint: HINT_NONE,
      })
    }

    return exposeMatches({
      authorized,
      exposed,
      eager,
      matches,
      hasMoreMatches: available.length > matches.length,
    })
  } catch (err: unknown) {
    return toolErrorResult('unexpected', formatErrForLog(err).message)
  }
}

function exposeMatches(input: ExposeMatchesInput): ToolResult {
  const { authorized, exposed, eager, matches, hasMoreMatches } = input
  const nextExposed = new Set(exposed)
  const { loaded, evicted } = admitMatches({ exposed: nextExposed, eager, matches })
  const isCapped = hasMoreMatches || matches.some(({ tool }) => !nextExposed.has(tool.name))
  const result = toolSuccessResult({
    matches: matches.map(({ tool }) => toCatalogItem(tool)),
    loaded,
    ...(evicted.length === 0 ? {} : { evicted }),
    exposed: authorized.filter((tool) => nextExposed.has(tool.name)).map((tool) => tool.name),
    isCapped,
    hint: loaded.length === 1 ? `${loaded[0]}: ${HINT_CALL_NOW}` : HINT_PICK_ONE,
  })

  for (const name of evicted) {
    exposed.delete(name)
  }

  for (const name of loaded) {
    exposed.add(name)
  }

  return result
}

/** A full set that never yields makes every later search return nothing, which reads as "no such
 *  tool" rather than "no room". Evicting costs a round-trip instead: the gate reloads by name. */
function admitMatches(input: AdmitMatchesInput): Admitted {
  const { exposed, eager, matches } = input
  const keep = new Set(matches.map(({ tool }) => tool.name))
  const loaded: string[] = []
  const evicted: string[] = []

  for (const { tool } of matches) {
    if (exposed.has(tool.name)) {
      continue
    }

    if (exposed.size >= MAX_EXPOSED_TOOL_COUNT) {
      const victim = oldestSearched(exposed, eager, keep)

      if (victim === undefined) {
        break
      }

      exposed.delete(victim)
      evicted.push(victim)
    }

    exposed.add(tool.name)
    loaded.push(tool.name)
  }

  return { loaded, evicted }
}

/** Insertion order is load order, since the eager names go in at construction. */
function oldestSearched(
  exposed: ReadonlySet<string>,
  eager: ReadonlySet<string>,
  keep: ReadonlySet<string>
): string | undefined {
  for (const name of exposed) {
    if (!(eager.has(name) || keep.has(name))) {
      return name
    }
  }

  return undefined
}

function toCatalogItem(tool: ToolDefinition): CatalogItem {
  return { name: tool.name, description: tool.description }
}

function toolSuccessResult(value: object): ToolResult {
  return { content: JSON.stringify(value), isError: false }
}

function toolErrorResult(code: ToolErrorCode, message: string): ToolResult {
  const error = createToolError(code, message)
  return { content: error.message, isError: true }
}

function createToolError(code: ToolErrorCode, message: string): ToolError {
  return new ToolError(code, message)
}
