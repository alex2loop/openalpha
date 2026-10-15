import type { ToolInvocationContext } from '@/core/tool'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import { ToolError } from '@/core/errors'

/** The read-only arm of each managed tool, under the name that tool gave it: `alert_manage` lists,
 *  `brief_manage` shows. Matching one name only would gate the other tool's read arm as a write. */
const MANAGED_READ_ACTIONS: ReadonlySet<string> = new Set(['list', 'show'])

/** `alert_manage` and `brief_manage` declare `read` because their always-available arm only reads;
 *  their other arms mutate durable state. The approval gate — not the capability label — is the
 *  mutation gate for both, so any policy keying off capability alone must not treat them as
 *  read-only. */
export function isManagedMutation(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || !('action' in input)) {
    return false
  }

  const { action } = input

  return typeof action !== 'string' || !MANAGED_READ_ACTIONS.has(action)
}

/** A delivery target is always the address the operator is speaking from. Neither tool accepts a
 *  channel or chat id as an argument, so an agent cannot address a third party. */
export function invocationAddress(ctx: ToolInvocationContext): DeliveryAddress {
  if (ctx.chatId === undefined) {
    throw new ToolError('invalid_input', 'this surface has no chat to deliver to')
  }

  return { channel: ctx.channel, chatId: ctx.chatId }
}

/** The run plus this exact call is the only identity a ledger mutation may key on: the model
 *  supplies neither, and reusing a provider call id in a different run cannot collide. */
export function ledgerIdempotencyKey(ctx: ToolInvocationContext): string {
  return JSON.stringify([ctx.runId, ctx.callId])
}
