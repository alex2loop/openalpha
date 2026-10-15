import { z } from 'zod'

import { createTool } from '@/core/tool'
import {
  isMemoryMutationApprovalRequired,
  MEMORY_KEY_SCHEMA,
  scopedKey,
  toMemoryScope,
} from '@/tools/memory/scope'

export const memoryRemoveTool = createTool({
  name: 'memory_remove',
  description:
    'Deletes the note stored under one exact key and reports whether one existed. Use it only when the operator asks to forget something they had asked to remember. Returns the key and a removed flag.',
  inputSchema: z.object({ key: MEMORY_KEY_SCHEMA }),
  capability: 'memory',
  presentation: { label: 'Forget', emoji: '🧠', detailKeys: ['key'] },
  requiresApproval: isMemoryMutationApprovalRequired,
  async execute(args, ctx): Promise<string> {
    const actual = scopedKey(ctx, args.key)
    const removed = await ctx.memory.remove(toMemoryScope(ctx), actual)

    return JSON.stringify({ removed, key: args.key })
  },
})
