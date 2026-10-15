import { z } from 'zod'

import { createTool } from '@/core/tool'
import { MEMORY_KEY_SCHEMA, scopedKey, toMemoryScope } from '@/tools/memory/scope'

export const memoryRecallTool = createTool({
  name: 'memory_recall',
  description:
    'Returns the note stored under one exact key, or null when nothing is stored there. Use it when the key is known; use memory_fts_recall to find a note by content. Facts another tool owns, such as the investor profile or the ledger, are read from that tool, never from memory.',
  inputSchema: z.object({ key: MEMORY_KEY_SCHEMA }),
  capability: 'memory',
  presentation: { label: 'Recall', emoji: '🧠', detailKeys: ['key'] },
  async execute(args, ctx): Promise<string> {
    const actual = scopedKey(ctx, args.key)

    return JSON.stringify(await ctx.memory.recall(toMemoryScope(ctx), actual))
  },
})
