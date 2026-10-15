import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import { createTool } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'
import { buildScope, isScheduleMutationApprovalRequired } from '@/tools/schedule/scope'
import { toSummaryJson } from '@/tools/summary'

export const scheduleRemoveTool = createTool({
  name: 'schedule_remove',
  description:
    'Delete one scheduled job by id. The id comes from schedule_add or schedule_list; a unique prefix is enough. ' +
    'A job already reported as done has nothing left to cancel — do not remove one to tidy up unless the user asks.',
  inputSchema: z.object({
    id: z
      .string()
      .min(1)
      .describe(
        'Job id from schedule_add or schedule_list. Accepts a unique prefix. Example: "a1b2c3d4".'
      ),
  }),
  capability: 'schedule',
  presentation: { label: 'Remove schedule', emoji: '⏰', detailKeys: ['id'] },
  requiresApproval: isScheduleMutationApprovalRequired,
  summarizeResult: summarizeRemoveResult,
  async execute(args, ctx): Promise<string> {
    const scope = buildScope(ctx)
    const id = await ctx.services.jobs.resolveIdPrefix(scope, args.id)

    await ctx.services.jobs.remove(scope, id)

    return JSON.stringify({ removed: true, id })
  },
})

function summarizeRemoveResult(content: string): DisplayText | undefined {
  const parsed = toSummaryJson(content)

  return isPlainRecord(parsed) && parsed.removed === true
    ? { key: 'toolSummaries.scheduleRemoved' }
    : undefined
}
