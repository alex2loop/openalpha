import type { App } from '@/core/container'
import type { AgentProfile, RunInput } from '@/engine/api'
import chatRule from '@/app/browser/chat-rule.md' with { type: 'text' }
import { CHAT_TOOLS } from '@/app/browser/edition'
import { BRAND } from '@/core/brand'
import { ConfigError } from '@/core/errors'
import { type AgentId, agentId, DEFAULT_AGENT_ID } from '@/core/ids'
import { DEEP_RESEARCHER_ID } from '@/engine/api'
import { t } from '@/i18n'

const SLOT_RE = /\{(\w+)\}/g

/** The agent a web run speaks as: the chat agent narrowed to `CHAT_TOOLS` and told the web's rule,
 *  the research agent (which writes what `/research` shows) told the same rule with its tools kept;
 *  every other agent as configured. */
export function createChatAgentForRun(
  app: App
): (input: RunInput, fallback: AgentProfile) => AgentProfile {
  const rule = fillSlots(chatRule, slotsOf(app))
  const narrowed = [buildChatAgent(app, rule), buildResearchAgent(app, rule)]

  return (_input, fallback) => narrowed.find(({ id }) => id === fallback.id) ?? fallback
}

function buildChatAgent(app: App, rule: string): AgentProfile {
  const configured = registeredAgent(app, DEFAULT_AGENT_ID)

  const registered = app.resolve('tools')
  const missing = [...CHAT_TOOLS].filter((name) => !registered.has(name))

  if (missing.length > 0) {
    throw new ConfigError(`web chat tools not registered: ${missing.join(', ')}`)
  }

  const { maxSpawn: _maxSpawn, ...rest } = configured

  return {
    ...rest,
    tools: configured.tools.filter((name) => CHAT_TOOLS.has(name)),
    delegates: [],
    systemPrompt: `${configured.systemPrompt}\n\n${rule}`,
  }
}

function buildResearchAgent(app: App, rule: string): AgentProfile {
  const configured = registeredAgent(app, agentId(DEEP_RESEARCHER_ID))

  return { ...configured, systemPrompt: `${configured.systemPrompt}\n\n${rule}` }
}

function registeredAgent(app: App, id: AgentId): AgentProfile {
  const configured = app.resolve('agents').get(id)

  if (configured === undefined) {
    throw new ConfigError(`web agent ${id} not registered`)
  }

  return configured
}

function slotsOf(app: App): Readonly<Record<string, string>> {
  const locale = app.config.locale.language

  return {
    brand: BRAND.display,
    refusal: `${t(locale, 'ui.office.edition.chat.refusal')} ${t(locale, 'trading.analysis.web-scope')}`,
    offTopic: t(locale, 'ui.office.edition.chat.offTopic', { brand: BRAND.display }),
  }
}

// A slot the rule lacks would silently drop copy, and a token left unfilled would reach the model.
function fillSlots(text: string, slots: Readonly<Record<string, string>>): string {
  for (const name of Object.keys(slots)) {
    if (!text.includes(`{${name}}`)) {
      throw new ConfigError(`web chat rule has no {${name}} slot`)
    }
  }

  return text.replace(SLOT_RE, (token, name: string) => {
    const value = Object.hasOwn(slots, name) ? slots[name] : undefined

    if (value === undefined) {
      throw new ConfigError(`web chat rule has an unknown slot ${token}`)
    }

    return value
  })
}
