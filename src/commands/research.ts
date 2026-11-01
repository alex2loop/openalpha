import type {
  CommandDescription,
  CommandMessage,
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import { RESEARCH_PROFILE_DEPTHS } from '@/core/config/resolve'
import { agentId } from '@/core/ids'
import { DEEP_RESEARCHER_ID, RESEARCH_DEPTH_PREFIX, RESEARCH_QUERY_MAX_CHARS } from '@/engine/api'

const USAGE: CommandMessage = { key: 'slash.researchUsage' }
const MESSAGE_KEYS = [USAGE.key, 'slash.researchQueryTooLong'] as const
const DESCRIPTION: CommandDescription = { kind: 'localized', key: 'slash.researchHelp' }
const POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'member',
  action: 'costly',
  execution: { progressKey: 'slash.researchProgress' },
} as const satisfies SlashInvocationPolicy
const DEFAULT_RESEARCH_DEPTH = RESEARCH_PROFILE_DEPTHS.standard
const RESEARCH_AGENT_ID = agentId(DEEP_RESEARCHER_ID)

type ResearchProfile = keyof typeof RESEARCH_PROFILE_DEPTHS

export function createResearchCommand(): SlashCommand {
  return {
    name: 'research',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: POLICY,
    usage: () => USAGE,
    run: runResearchCommand,
  }
}

async function runResearchCommand(ctx: SlashContext): Promise<SlashResult> {
  const [first, ...rest] = ctx.args
  const profile = first !== undefined && isResearchProfile(first) ? first : undefined
  const depth = profile === undefined ? DEFAULT_RESEARCH_DEPTH : RESEARCH_PROFILE_DEPTHS[profile]
  const query = (profile === undefined ? ctx.args : rest).join(' ').trim()

  if (query === '') {
    return { kind: 'message', messages: [USAGE] }
  }

  if (query.length > RESEARCH_QUERY_MAX_CHARS) {
    return {
      kind: 'message',
      messages: [{ key: 'slash.researchQueryTooLong', values: { max: RESEARCH_QUERY_MAX_CHARS } }],
    }
  }

  return {
    kind: 'agent',
    retryMessage: `${RESEARCH_DEPTH_PREFIX}${depth} ${query}`,
    agentId: RESEARCH_AGENT_ID,
  }
}

function isResearchProfile(value: string): value is ResearchProfile {
  return Object.hasOwn(RESEARCH_PROFILE_DEPTHS, value)
}
