import type { SessionId } from '@/core/ids'
import type { ProgressMessage } from '@/core/stream-events'
import type { ToolResult } from '@/core/tool'
import type { ToolApproval } from '@/engine/types/approval'

export interface McpToolInvoker {
  invoke(input: McpToolInvocation): Promise<ToolResult>
}

export interface McpToolInvocation {
  readonly name: string
  readonly sessionId: SessionId
  readonly input: unknown
  readonly signal?: AbortSignal
  // Absent when the client cannot prompt: the call has no approver and dangerous tools fail closed.
  readonly approval?: ToolApproval
  /** Forwarded to the transport as a progress notification. */
  readonly progress?: (message: ProgressMessage) => void
}
