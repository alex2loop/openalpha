import type { StreamPrinter } from '@/cli/commands/chat/render'
import type { CliApp, CompletionSource } from '@/cli/types'
import type { AgentId, SessionId } from '@/core/ids'
import type { RunOptions } from '@/engine/api'

/** The cli is one operator in one terminal: a single, stable chat that its agent binding hangs off. */
export const CLI_CHAT_ID = 'local'

export interface ChatDisplay {
  readonly agentName: string
  readonly model: string
}

export interface ChatFlags {
  readonly agent?: string
  readonly message?: string
  /** `--mode` accepts manual | bypass; a one-shot with no way to prompt forces unavailable. */
  readonly mode?: RunOptions['approvalMode']
  readonly continue: boolean
  readonly maxTurns?: number
  readonly maxCostUsd?: number
}

export interface ReplState {
  sessionId: SessionId
  agentId: AgentId
  // The CLI owns its run directly (single foreground process, one run at a time), so it aborts via a local controller.
  controller: AbortController | null
  // The turn's printer, set while a turn runs: the approval prompt pauses it so the spinner can't clobber the question.
  printer: StreamPrinter | null
}

export interface ChatSession {
  readonly app: CliApp
  readonly flags: ChatFlags
  readonly state: ReplState
  readonly display: ChatDisplay
  readonly completion: CompletionSource
}
