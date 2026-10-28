import { randomUUID } from 'node:crypto'

import type { SlashDispatcher } from '@/commands/api'
import type { App } from '@/core/container'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { RunInput } from '@/engine/api'
import type { Job, JobCommandAnswer, JobCommandRun } from '@/scheduler/api'
import {
  commandHeadOf,
  renderMessages,
  SCHEDULED_COMMAND_SURFACE,
  scheduledCommandLine,
  scheduledCommandRefusal,
} from '@/commands/api'
import { ValidationError } from '@/core/errors'
import { bindLocale } from '@/i18n'

/** Runs a job whose prompt is a slash command through the dispatcher the app's chat uses, as the
 *  operator, so it answers without a model unless the command itself hands the turn to one. A
 *  command that changes anything is refused here too: a job stored before that rule must not run it. */
export async function runJobCommand(
  app: App,
  work: { readonly job: Job; readonly input: RunInput; readonly run: JobCommandRun }
): Promise<JobCommandAnswer | undefined> {
  const { job, input, run } = work
  const line = scheduledCommandLine(job.prompt)
  const chatId = job.target?.chatId ?? job.id

  if (commandHeadOf(line) === null) {
    return undefined
  }

  const dispatcher = app.resolve('slashDispatcher')
  const refusal = scheduledCommandRefusal(dispatcher, line)

  if (refusal !== undefined) {
    throw new ValidationError(refusal.message, refusal.operator)
  }

  await run.onWorkStart?.()
  await app.resolve('sessionStore').create({
    id: input.sessionId,
    agentId: input.agentId,
    userId: input.userId,
    channel: input.channel,
    chatId,
  })

  const { language } = app.config.locale
  const result = await dispatchJobLine(dispatcher, {
    line,
    signal: run.signal,
    context: {
      channel: input.channel,
      surface: SCHEDULED_COMMAND_SURFACE,
      userId: input.userId,
      sessionId: input.sessionId,
      chatId,
      role: 'operator',
      locale: language,
      args: [],
      isScheduled: true,
    },
  })

  return toAnswer(result, language)
}

function toAnswer(result: SlashResult | null, language: Locale): JobCommandAnswer {
  switch (result?.kind) {
    case 'message':
      return { kind: 'text', text: renderMessages(bindLocale(language), result) }
    case 'text':
      return { kind: 'text', text: result.text }
    case 'agent':
      return {
        kind: 'agent',
        message: result.retryMessage,
        ...(result.agentId === undefined ? {} : { agentId: result.agentId }),
      }
    default:
      return { kind: 'text', text: '' }
  }
}

interface JobLine {
  readonly line: string
  readonly signal: AbortSignal
  readonly context: Omit<SlashContext, 'requestId' | 'signal'>
}

// A long command already shows as a run; a short one is shown here, so every scheduled command
// leaves a row in the activity log. One that hands its turn to an agent leaves the agent's row.
async function dispatchJobLine(
  dispatcher: SlashDispatcher,
  job: JobLine
): Promise<SlashResult | null> {
  const { line, context } = job
  const dispatch = (signal: AbortSignal): Promise<SlashResult | null> =>
    dispatcher.dispatch(line, { ...context, requestId: randomUUID(), signal })
  const resolved = dispatcher.resolve(line)

  if (resolved === null || resolved.policy.execution !== undefined) {
    return await dispatch(job.signal)
  }

  return await dispatcher.runScheduled({
    name: resolved.command.name,
    signal: job.signal,
    work: (shown) => dispatch(shown.signal),
    isIdle: (answer) => answer?.kind === 'agent',
  })
}
