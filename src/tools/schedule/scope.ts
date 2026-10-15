import type { ToolInvocationContext } from '@/core/tool'
import type { JobToolScope } from '@/tools/schedule/types'
import { ToolError } from '@/core/errors'

export const SCHEDULER_PROMPT_MAX_BYTES = 10_240

export function buildScope(ctx: ToolInvocationContext): JobToolScope {
  const scope: JobToolScope = {
    agentId: ctx.agentId,
    userId: ctx.userId,
    channel: ctx.channel,
    tz: ctx.config.locale.timezone,
  }

  return ctx.chatId === undefined ? scope : { ...scope, chatId: ctx.chatId }
}

export function assertPromptSize(prompt: string): void {
  const promptBytes = Buffer.byteLength(prompt, 'utf8')

  if (promptBytes > SCHEDULER_PROMPT_MAX_BYTES) {
    throw new ToolError(
      'payload_too_large',
      `prompt size ${promptBytes} exceeds cap ${SCHEDULER_PROMPT_MAX_BYTES}`
    )
  }
}

// Listing is read-only; creating or deleting a job always faces the operator.
export function isScheduleMutationApprovalRequired(): boolean {
  return true
}
