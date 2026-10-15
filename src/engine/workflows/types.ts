import type { AgentId } from '@/core/ids'
import type { RunResult } from '@/engine/types/run'

export interface WorkflowStep {
  readonly agent: AgentId
  readonly prompt: string
}

export interface WorkflowContext {
  run(agentId: AgentId, userMessage: string): Promise<RunResult>
}

export interface Workflow {
  readonly id: string
  readonly description?: string
  readonly schedule?: string
  readonly tz?: string
  readonly source: string
  run(ctx: WorkflowContext): Promise<unknown>
}
