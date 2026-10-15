import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { AgentBuildContext } from '@/engine/agents/builder'
import type { AgentProfile } from '@/engine/types/agent'
import { agentId, isPathId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { assertAgentTomlMatchesSourceId, loadAgentFromText } from '@/engine/agents/builder'

const AGENT_FILE = 'agent.toml'
const USER_AGENTS_DIR = 'agents'

/** One definition of where a user agent lives: boot reads this tree, the CLI writes into it. */
export function userAgentsDir(dataDir: string): string {
  return join(dataDir, USER_AGENTS_DIR)
}

export function userAgentFile(dataDir: string, id: AgentId): string {
  return join(userAgentsDir(dataDir), id, AGENT_FILE)
}

/** One `<agentsDir>/<id>/agent.toml`, read but not yet parsed. */
export interface UserAgentSource {
  readonly id: AgentId
  readonly toml: string
}

export interface BuildUserAgentsDeps {
  readonly ctx: AgentBuildContext
  /** Ids that may not be shadowed — the built-ins, and anything a trusted plugin contributed. */
  readonly reserved: ReadonlySet<string>
  readonly logger: Logger
}

/**
 * Read every user agent off disk. Split from the build step because a profile can only be built
 * once the full tool registry is known, and the container assembles that synchronously.
 * A missing directory is the normal case, not an error.
 */
export async function readUserAgents(dir: string): Promise<readonly UserAgentSource[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const sources: UserAgentSource[] = []

  for (const entry of entries) {
    if (!(entry.isDirectory() && isPathId(entry.name))) {
      continue
    }

    const id = agentId(entry.name)
    const toml = await readFile(join(dir, id, AGENT_FILE), 'utf8').catch(() => null)

    if (toml !== null) {
      sources.push({ id, toml })
    }
  }

  return sources
}

/**
 * Strictly additive. An id that collides with a reserved one is skipped, never allowed to shadow it:
 * a file dropped into a directory does not get to redefine a shipped agent. A malformed TOML is
 * skipped too — one bad agent must not keep the daemon from booting.
 */
export function buildUserAgents(
  sources: readonly UserAgentSource[],
  deps: BuildUserAgentsDeps
): ReadonlyMap<string, AgentProfile> {
  const agents = new Map<string, AgentProfile>()

  for (const source of sources) {
    if (deps.reserved.has(source.id)) {
      deps.logger.warn('agents.user_id_reserved', { id: source.id })
      continue
    }

    const agent = buildOne(source, deps)

    if (agent !== null) {
      agents.set(agent.id, agent)
    }
  }

  return agents
}

function buildOne(source: UserAgentSource, deps: BuildUserAgentsDeps): AgentProfile | null {
  try {
    assertAgentTomlMatchesSourceId(source.toml, source.id)
    return loadAgentFromText(source.toml, source.id, deps.ctx)
  } catch (err: unknown) {
    deps.logger.warn('agents.user_load_failed', { id: source.id, err: formatErrForLog(err) })

    return null
  }
}
