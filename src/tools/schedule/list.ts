import { z } from 'zod'

import { createTool } from '@/core/tool'
import { buildScope } from '@/tools/schedule/scope'

export const scheduleListTool = createTool({
  name: 'schedule_list',
  description:
    "List this agent's scheduled jobs. Each carries status=scheduled (will fire), paused, or done (already ran). " +
    'Only scheduled and paused jobs are live: never ask the user what to do about a done job, and never count one as a conflict with a new schedule.',
  inputSchema: z.object({}),
  capability: 'schedule',
  presentation: { label: 'List schedules', emoji: '⏰' },
  async execute(_args, ctx): Promise<string> {
    return JSON.stringify(await ctx.services.jobs.list(buildScope(ctx)))
  },
})
