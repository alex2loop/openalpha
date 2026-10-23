import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { ChannelId } from '@/core/channels'
import type { RunId, SessionId } from '@/core/ids'
import type { ToolResult } from '@/core/tool'
import { createTool } from '@/core/tool'

const CLARIFICATION_MAX_CHARS = 2_000

declare module '@/core/events' {
  interface BusEventMap {
    // channel/chatId are how a subscriber routes the question back to the human who can answer it;
    // a run with no chat (cli, scheduler) carries neither. `requestId` keys the pending question for
    // a surface that lists it; `askedAt` is epoch ms.
    clarification_requested: {
      readonly requestId: string
      readonly runId: RunId
      readonly askedAt: number
      readonly sessionId: SessionId
      readonly channel: ChannelId
      readonly chatId?: string
      readonly question: string
    }
  }
}

export const askClarificationTool = createTool({
  name: 'ask_clarification',
  description:
    'Sends one question to the human operator and ends the turn until they answer. Use it only when the answer changes what to do and no tool or stored fact can supply it; never for a fact the ledger, profile, or memory already holds. Returns a confirmation; the answer arrives as the next user message.',
  inputSchema: z.object({
    question: z
      .string()
      .min(1)
      .max(CLARIFICATION_MAX_CHARS)
      .describe(
        "One question in the operator's language, specific enough that a one-line answer resolves it."
      ),
  }),
  capability: 'read',
  eager: true,
  presentation: { label: 'Ask clarification', emoji: '🙋' },
  async execute(args, ctx): Promise<ToolResult> {
    ctx.bus.emit('clarification_requested', {
      requestId: randomUUID(),
      runId: ctx.runId,
      askedAt: Date.now(),
      sessionId: ctx.sessionId,
      channel: ctx.channel,
      ...(ctx.chatId === undefined ? {} : { chatId: ctx.chatId }),
      question: args.question,
    })

    // The CLI has no bus relay for this event, so the question rides on the tool line it prints.
    return {
      content: `Clarification requested: ${args.question}`,
      isError: false,
      display: args.question,
    }
  },
})
