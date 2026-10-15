import type { ToolDefinition } from '@/core/tool'
import { toToolSchema } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'

const TOKEN_RE = /[\p{L}\p{N}]+/gu
const NAME_SEPARATOR_RE = /[_-]+/g
const WHITESPACE_RUN_RE = /\s+/g

export interface RankedTool {
  readonly tool: ToolDefinition
  readonly isExact: boolean
  readonly isPrefix: boolean
  readonly isSchemaMatch: boolean
  readonly nameHits: number
  readonly descriptionHits: number
  readonly schemaHits: number
  readonly index: number
}

interface RankToolInput {
  readonly tool: ToolDefinition
  readonly index: number
  readonly query: string
  readonly terms: readonly string[]
}

export function rankTools(tools: readonly ToolDefinition[], query: string): readonly RankedTool[] {
  const normalized = normalizeSearchText(query)
  const terms = toSearchTerms(normalized)
  const ranked = tools
    .map((tool, index) => rankTool({ tool, index, query: normalized, terms }))
    .filter(hasRankMatch)
    .sort(compareRanks)
  const exact = ranked.find((rank) => rank.isExact)

  return exact === undefined ? ranked : [exact]
}

function rankTool(input: RankToolInput): RankedTool {
  const { tool, index, query, terms } = input
  const name = normalizeSearchText(tool.name)
  const description = normalizeSearchText(tool.description)
  const schema = normalizeSearchText(toSchemaSearchText(toToolSchema(tool).parameters))
  const schemaHits = countMatches(schema, terms)

  return {
    tool,
    isExact: name === query,
    isPrefix: name.startsWith(query),
    isSchemaMatch: schemaHits === terms.length,
    nameHits: countMatches(name, terms),
    descriptionHits: countMatches(description, terms),
    schemaHits,
    index,
  }
}

function hasRankMatch(rank: RankedTool): boolean {
  return (
    rank.isExact ||
    rank.isPrefix ||
    rank.nameHits > 0 ||
    rank.descriptionHits > 0 ||
    rank.isSchemaMatch
  )
}

function compareRanks(left: RankedTool, right: RankedTool): number {
  if (left.isExact !== right.isExact) {
    return left.isExact ? -1 : 1
  }

  if (left.isPrefix !== right.isPrefix) {
    return left.isPrefix ? -1 : 1
  }

  const nameDifference = right.nameHits - left.nameHits

  if (nameDifference !== 0) {
    return nameDifference
  }

  const descriptionDifference = right.descriptionHits - left.descriptionHits

  if (descriptionDifference !== 0) {
    return descriptionDifference
  }

  const schemaDifference = right.schemaHits - left.schemaHits

  if (schemaDifference !== 0) {
    return schemaDifference
  }

  return left.index - right.index
}

function countMatches(text: string, terms: readonly string[]): number {
  const textTerms = toSearchTerms(text)

  return terms.filter((term) => textTerms.includes(term)).length
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(NAME_SEPARATOR_RE, ' ').replace(WHITESPACE_RUN_RE, ' ')
}

function toSearchTerms(value: string): readonly string[] {
  return [...new Set(value.match(TOKEN_RE) ?? [])]
}

function toSchemaSearchText(schema: unknown): string {
  const parts: string[] = []

  collectSchemaText(schema, parts)
  return parts.join(' ')
}

function collectSchemaText(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSchemaText(item, parts)
    }
    return
  }
  if (!isPlainRecord(value)) {
    return
  }

  if (typeof value.description === 'string') {
    parts.push(value.description)
  }
  if (isPlainRecord(value.properties)) {
    parts.push(...Object.keys(value.properties))
  }

  for (const child of Object.values(value)) {
    collectSchemaText(child, parts)
  }
}
