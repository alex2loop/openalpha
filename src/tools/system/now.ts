import { z } from 'zod'

import type { ToolResult } from '@/core/tool'
import { createTool } from '@/core/tool'

export const nowTool = createTool({
  name: 'now',
  description:
    "Returns the current instant as ISO-8601 UTC together with the operator's local wall-clock time and timezone. Use it before any date arithmetic, relative-time answer, or schedule, because the model has no clock of its own. Takes no input.",
  inputSchema: z.object({}),
  capability: 'read',
  presentation: { label: 'Now', emoji: '🕐' },
  eager: true,
  async execute(_args, ctx): Promise<ToolResult> {
    const now = new Date()
    const tz = ctx.config.locale.timezone

    const local = `${formatInZone(now, tz)} ${tz}`

    // The instant alone leaves the model guessing what "3pm" means to the operator, so the zone
    // its schedules are read in rides along. The human reads the same zone, year first and on a
    // 24-hour clock in every locale: a bare `en` would print month first on a 12-hour clock.
    return { content: `${now.toISOString()} (${local})`, isError: false, display: local }
  },
})

// h23, not hour12: the h24 cycle renders midnight as 24:00 and reads as the wrong day.
function formatInZone(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(at)
}
