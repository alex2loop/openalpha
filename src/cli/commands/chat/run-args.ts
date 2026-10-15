import type { ChatFlags } from '@/cli/commands/chat/types'
import type { AgentId, SessionId } from '@/core/ids'
import type { OnStreamEvent } from '@/core/stream-events'
import type { Budget } from '@/core/types/budget'
import type { ForegroundResearchInteraction, RunInput, RunOptions } from '@/engine/api'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { LOCAL_USER_ID } from '@/core/ids'
import { createBudget } from '@/engine/api'

const CLI_CHANNEL_ID = LOCAL_CHANNEL_ID

interface TurnInput {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly message: string
  readonly onChunk: OnStreamEvent
}

interface BuildRunOptionsInput {
  readonly flags: ChatFlags
  readonly signal?: AbortSignal
  readonly chatId?: string
  readonly researchInteraction?: ForegroundResearchInteraction
}

export function buildRunInput(input: TurnInput): RunInput {
  return {
    agentId: input.agentId,
    sessionId: input.sessionId,
    userId: LOCAL_USER_ID,
    channel: CLI_CHANNEL_ID,
    userMessage: input.message,
    onChunk: input.onChunk,
  }
}

// Unlike channels (D4), the CLI's signal IS meaningful: one foreground process owns exactly one run, and the abort signal cancels that run.
export function buildRunOptions(input: BuildRunOptionsInput): RunOptions {
  const { flags } = input
  const budget: Budget | undefined =
    flags.maxCostUsd === undefined ? undefined : createBudget(flags.maxCostUsd)

  return {
    ...(flags.mode === undefined ? {} : { approvalMode: flags.mode }),
    ...(input.signal === undefined ? {} : { parentSignal: input.signal }),
    ...(input.chatId === undefined ? {} : { chatId: input.chatId }),
    ...(budget === undefined ? {} : { budgetSlice: budget }),
    ...(flags.maxTurns === undefined ? {} : { maxTurns: flags.maxTurns }),
    ...(input.researchInteraction === undefined
      ? {}
      : { researchInteraction: input.researchInteraction }),
  }
}
