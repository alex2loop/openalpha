import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { z } from 'zod'

import type { AgentDetailWire, AgentFocusWire, AgentWriteBody } from '@/app/server/wire/agents'
import type { AgentProfile } from '@/engine/api'
import { isPlainRecord } from '@/core/utils/collections'

const MAX_LIST_ITEMS = 20
const MAX_NAME_CHARS = 80
const MAX_DESCRIPTION_CHARS = 500
const MAX_PROMPT_CHARS = 20_000
const MAX_DAILY_USD = 1_000_000

/** Research on the web, memory, and the read-only market and suggestion tools. Never a shell, a file
 *  write or a schedule. A name the registry lacks is left out when the file is written. */
const WEB_AGENT_TOOLS: readonly string[] = Object.freeze([
  'web_search',
  'web_fetch',
  'memory_store',
  'memory_recall',
  'market_price',
  'market_bars',
  'market_overview',
  'market_events',
  'market_accounts',
  'market_sector_strength',
  'market_news',
  'market_sentiment',
  'market_funding',
  'macro_risk',
  'vn_foreign_flow',
  'vn_futures_basis',
  'suggestion_run',
  'suggestion_batch',
  'suggestion_track_record',
  'now',
  'calc',
])

// Keys the page owns: an edit replaces each, or removes it when the body leaves it out.
const MANAGED_KEYS = [
  'name',
  'description',
  'system_prompt',
  'focus',
  'max_daily_usd',
  'model_tier',
]

const FOCUS_BODY = z.strictObject({
  markets: z.array(z.string().min(1)).min(1).max(MAX_LIST_ITEMS).exactOptional(),
  sectors: z.array(z.string().min(1)).min(1).max(MAX_LIST_ITEMS).exactOptional(),
  horizon: z.enum(['short', 'long']).exactOptional(),
})

export const AGENT_WRITE_BODY = z.strictObject({
  id: z.string().min(1).exactOptional(),
  name: z.string().min(1).max(MAX_NAME_CHARS),
  description: z.string().min(1).max(MAX_DESCRIPTION_CHARS).exactOptional(),
  systemPrompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  focus: FOCUS_BODY.exactOptional(),
  maxDailyUsd: z.number().nonnegative().max(MAX_DAILY_USD).exactOptional(),
  modelTier: z.string().min(1).exactOptional(),
})

/** The TOML text for the body. An edit passes the file's current text: what the page does not own
 *  (turn and token caps, hosts, skills, delegates) is kept, and only the tool list is the preset. */
export function toAgentToml(
  body: AgentWriteBody,
  availableTools: readonly string[],
  existing?: string
): string {
  const parsed: unknown = existing === undefined ? {} : parseToml(existing)
  const base = isPlainRecord(parsed) ? parsed : {}
  const kept = Object.fromEntries(
    Object.entries(base).filter(([key]) => !MANAGED_KEYS.includes(key))
  )
  const capabilities = isPlainRecord(base.capabilities) ? base.capabilities : {}
  const tools = WEB_AGENT_TOOLS.filter((name) => availableTools.includes(name))

  return stringifyToml({
    ...kept,
    name: body.name,
    ...(body.description === undefined ? {} : { description: body.description }),
    system_prompt: body.systemPrompt,
    ...(body.maxDailyUsd === undefined ? {} : { max_daily_usd: body.maxDailyUsd }),
    ...(body.modelTier === undefined ? {} : { model_tier: body.modelTier }),
    ...(body.focus === undefined ? {} : { focus: body.focus }),
    capabilities: { ...capabilities, tools },
  })
}

function toFocusWire(raw: AgentProfile['focus']): AgentFocusWire | undefined {
  const parsed = FOCUS_BODY.safeParse(raw)

  return parsed.success ? parsed.data : undefined
}

export function toAgentDetailWire(agent: AgentProfile, editable: boolean): AgentDetailWire {
  const focus = toFocusWire(agent.focus)

  return {
    id: agent.id,
    name: agent.name,
    ...(agent.description === undefined ? {} : { description: agent.description }),
    systemPrompt: agent.systemPrompt,
    ...(focus === undefined ? {} : { focus }),
    ...(agent.maxDailyUsd === undefined ? {} : { maxDailyUsd: agent.maxDailyUsd }),
    ...(agent.modelChain.kind === 'tier' ? { modelTier: agent.modelChain.name } : {}),
    editable,
  }
}
