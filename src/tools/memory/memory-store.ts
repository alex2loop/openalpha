import { z } from 'zod'

import { createTool } from '@/core/tool'
import {
  isMemoryMutationApprovalRequired,
  MEMORY_KEY_SCHEMA,
  scopedKey,
  toMemoryScope,
} from '@/tools/memory/scope'

export const memoryStoreTool = createTool({
  name: 'memory_store',
  description:
    'Stores a free-form note under a key so a later turn can recall it. Use it only when the operator asks to remember something. Their investing style, personal rules, interests, context and how they want answers are saved automatically from what they say, so never store those here. A fact another tool owns, such as risk level or a trade, is written through that tool, never here. Overwrites an existing note under the same key.',
  inputSchema: z.object({
    key: MEMORY_KEY_SCHEMA,
    value: z.string().min(1).describe("The note text to store, in the operator's own words."),
  }),
  capability: 'memory',
  eager: true,
  presentation: { label: 'Remember', emoji: '🧠', detailKeys: ['key'] },
  requiresApproval: isMemoryMutationApprovalRequired,
  async execute(args, ctx): Promise<string> {
    const actual = scopedKey(ctx, args.key)
    await ctx.memory.store(toMemoryScope(ctx), actual, { value: args.value })

    return JSON.stringify({ stored: true, key: args.key })
  },
})
