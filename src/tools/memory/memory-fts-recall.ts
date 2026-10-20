import { z } from 'zod'

import { createTool } from '@/core/tool'
import { childKeyPrefix, toMemoryScope } from '@/tools/memory/scope'

const MEMORY_SEARCH_MAX_RESULTS = 50
const MEMORY_SEARCH_DEFAULT_RESULTS = 10

export const memoryFtsRecallTool = createTool({
  name: 'memory_fts_recall',
  description:
    'Full-text search over stored notes, returning the closest matches with their keys and text. Use it to find a note whose key is unknown, or to check what was remembered about a topic before asking the operator. An empty list means nothing was stored; that is an answer, not an error.',
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('Words to search for in stored notes; plain text, not a key.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MEMORY_SEARCH_MAX_RESULTS)
      .default(MEMORY_SEARCH_DEFAULT_RESULTS)
      .describe(`Maximum matches to return, 1 to ${MEMORY_SEARCH_MAX_RESULTS}.`),
  }),
  capability: 'memory',
  eager: true,
  presentation: { label: 'Recall (search)', emoji: '🧠', detailKeys: ['query'] },
  async execute(args, ctx): Promise<string> {
    const prefix = childKeyPrefix(ctx)
    const hits = await ctx.memory.search(toMemoryScope(ctx), args.query, args.limit, prefix)

    // Keys go back as the child addresses them, since recall and remove add the prefix again.
    return JSON.stringify(
      prefix === undefined
        ? hits
        : hits.map((hit) => ({ ...hit, key: hit.key.slice(prefix.length) }))
    )
  },
})
