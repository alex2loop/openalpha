import type { ToolInvocationContext } from '@/core/tool'
import type { JobToolScope } from '@/tools/schedule/types'

export function buildScope(ctx: ToolInvocationContext): JobToolScope {
  const scope: JobToolScope = {
    agentId: ctx.agentId,
    userId: ctx.userId,
    channel: ctx.channel,
    tz: ctx.config.locale.timezone,
  }

  return ctx.chatId === undefined ? scope : { ...scope, chatId: ctx.chatId }
}

// Listing is read-only; creating or deleting a job always faces the operator.
export function isScheduleMutationApprovalRequired(): boolean {
  return true
}
