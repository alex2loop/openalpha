import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import type { ScopedNewJobSchedule } from '@/tools/schedule/types'
import { ToolError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'
import { hasBlockingThreat, scanOutput } from '@/core/security/sanitize'
import { createTool } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'
import { SCHEDULER_MAX_JOBS } from '@/tools/schedule/policy'
import {
  assertPromptSize,
  buildScope,
  isScheduleMutationApprovalRequired,
  SCHEDULER_PROMPT_MAX_BYTES,
} from '@/tools/schedule/scope'
import {
  assertValidCron,
  formatNextRun,
  MAX_EPOCH_MS,
  MIN_EPOCH_MS,
  resolveTimezone,
  toEpochMs,
} from '@/tools/schedule/time'
import { toSummaryJson } from '@/tools/summary'

const inputSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .describe(
        'The full self-contained task the agent receives when the job fires. ' +
          "The run starts in a fresh session with NO prior chat context — write it as if the user is asking right now, in the user's own words and language. " +
          'Example: "Check the S&P 500 and summarize today\'s top movers."'
      ),
    cron_expr: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Recurring schedule (mutually exclusive with at). ' +
          'Standard 5-field cron: "minute hour day-of-month month day-of-week". ' +
          'Each field accepts *, N, N-M, */N, N-M/N, or a comma list of those. ' +
          'Examples: "0 12 * * *" = daily at 12:00, "0 9 * * 1-5" = weekdays at 09:00, ' +
          '"*/15 * * * *" = every 15 minutes. ' +
          'Evaluated in the job timezone (or the configured timezone if timezone is unset).'
      ),
    at: z
      .union([z.string().min(1), z.number().int().positive()])
      .optional()
      .describe(
        'One-shot schedule (mutually exclusive with cron_expr). ' +
          'A local wall-clock string "YYYY-MM-DD HH:mm" (preferred) or an epoch-millisecond number. ' +
          'A bare string is read in the job timezone — do NOT convert it to UTC. ' +
          'A trailing Z or ±HH:mm names the instant instead and overrides the job timezone. ' +
          'Must be in the future. Example: "2026-08-05 15:45".'
      ),
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe(
        'IANA timezone for this job; overrides the configured timezone for cron evaluation and ' +
          'for reading an at wall-clock string. Example: "Asia/Ho_Chi_Minh".'
      ),
  })
  .superRefine((data, ctx) => {
    if (data.cron_expr !== undefined && data.at !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['at'],
        message: 'cron_expr and at are mutually exclusive',
      })
    }

    if (data.cron_expr === undefined && data.at === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['cron_expr'],
        message: 'give cron_expr (recurring) or at (one-shot)',
      })
    }
  })

type ScheduleAddInput = z.infer<typeof inputSchema>

export const scheduleAddTool = createTool({
  name: 'schedule_add',
  description:
    'Schedule this agent to run a task later, once or on a repeat. ' +
    'This is the only way to act at a later time. ' +
    'The job runs in the background and its answer is delivered back to this same conversation on its own — never ask the user for credentials, tokens, or a chat id, and never try to reach the chat platform another way. ' +
    "`prompt` is the self-contained task the agent receives when the job fires: write it as if the user is asking right now, in the user's own words/language, since the run starts with no prior chat context. " +
    'Give cron_expr for a recurring job or at for a one-shot. ' +
    "Afterwards, say in one sentence, in the user's own language, what will run and when it fires, so they can catch a misunderstanding. Never show them the job id, the timezone name, or these field names. " +
    `Max ${SCHEDULER_MAX_JOBS} jobs per agent. Prompt capped at ${SCHEDULER_PROMPT_MAX_BYTES} bytes.`,
  inputSchema,
  inputExamples: [
    {
      prompt: "Summarize today's VN-Index close and the top three movers.",
      cron_expr: '0 17 * * 1-5',
    },
    {
      prompt: 'Remind me to review the FPT position.',
      at: '2026-09-15 09:00',
      timezone: 'Asia/Ho_Chi_Minh',
    },
  ],
  capability: 'schedule',
  // Eager because a missing schema reads to the model as a missing capability: asked to schedule
  // something it declines outright instead of reaching for tool_search.
  eager: true,
  // Ordered so the prompt reads left to right: when it fires, then what it will ask.
  presentation: { label: 'Add schedule', emoji: '⏰', detailKeys: ['cron_expr', 'at', 'prompt'] },
  requiresApproval: isScheduleMutationApprovalRequired,
  summarizeResult: summarizeAddResult,
  async execute(args, ctx): Promise<string> {
    const scope = buildScope(ctx)

    assertPromptSize(args.prompt)

    if (hasBlockingThreat(scanOutput(args.prompt))) {
      throw new ToolError('invalid_input', 'cron prompt rejected: injection pattern detected')
    }

    const tz = args.timezone === undefined ? scope.tz : resolveTimezone(args.timezone)
    const schedule = resolveSchedule(args, tz, Date.now())
    const row = await ctx.services.jobs.add(scope, { prompt: args.prompt, schedule })

    return JSON.stringify({
      added: true,
      id: row.id,
      prompt: scrubCredentials(args.prompt),
      ...(row.cronExpr === undefined ? {} : { cron_expr: row.cronExpr }),
      timezone: tz,
      next_run: formatNextRun(row.nextRunAt, tz),
    })
  },
})

// `now` is taken once so validation and the stored nextRunAt agree.
function resolveSchedule(args: ScheduleAddInput, tz: string, now: number): ScopedNewJobSchedule {
  if (args.cron_expr !== undefined) {
    assertValidCron(args.cron_expr, now, tz)

    return { kind: 'cron', expr: args.cron_expr, timezone: tz }
  }

  const at = args.at

  if (at === undefined) {
    throw new ToolError('invalid_input', 'give cron_expr or at')
  }

  if (typeof at === 'number' && at < MIN_EPOCH_MS) {
    throw new ToolError(
      'invalid_input',
      `${at} looks like epoch seconds - pass milliseconds, or a "YYYY-MM-DD HH:mm" string`
    )
  }

  const atMs = typeof at === 'number' ? at : toEpochMs(at, tz)

  if (!Number.isFinite(atMs) || atMs <= now) {
    throw new ToolError('invalid_input', 'that time is in the past - pick a future date and time')
  }

  if (atMs > MAX_EPOCH_MS) {
    throw new ToolError(
      'invalid_input',
      'that time is too far away - pick a date before year 10000'
    )
  }

  return { kind: 'once', atMs }
}

function summarizeAddResult(content: string): DisplayText | undefined {
  const parsed = toSummaryJson(content)

  if (!(isPlainRecord(parsed) && typeof parsed.next_run === 'string')) {
    return undefined
  }

  return { key: 'toolSummaries.scheduleAdded', params: { nextRun: parsed.next_run } }
}
