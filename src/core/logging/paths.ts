import { join } from 'node:path'

import type { AgentId } from '@/core/ids'

const LOG_SEGMENT_NUMBER = /^[1-9]\d*$/
export const AGENT_LOG_SEGMENTS = ['logs', 'agents'] as const
export const AGENT_LOG_FILE_NAME = 'agent.log'

export function isLogSegmentName(base: string, name: string): boolean {
  const prefix = `${base}.`

  return name.startsWith(prefix) && LOG_SEGMENT_NUMBER.test(name.slice(prefix.length))
}

export function resolveAgentLogFile(dataDir: string, agentId: AgentId): string {
  return join(resolveAgentLogsDir(dataDir), agentId, AGENT_LOG_FILE_NAME)
}

export function resolveAgentLogsDir(dataDir: string): string {
  return join(dataDir, ...AGENT_LOG_SEGMENTS)
}
