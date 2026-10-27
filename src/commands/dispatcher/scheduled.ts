import type { SlashDispatcher } from '@/commands/types'
import type { OperatorMessage } from '@/core/errors'
import type { CommandSurface } from '@/core/types/command'
import { commandHeadOf } from '@/commands/dispatcher/resolve'

const FIRST_LINE_END_RE = /\r?\n/

/** The surface a scheduled command runs as: the same one the app's own chat uses. */
export const SCHEDULED_COMMAND_SURFACE: CommandSurface = 'repl'

interface ScheduledCommandRefusal {
  /** English, for the agent and the log. */
  readonly message: string
  readonly operator: OperatorMessage
}

/** The slash line a job's prompt asks for: its first line, trimmed. */
export function scheduledCommandLine(prompt: string): string {
  return prompt.trim().split(FIRST_LINE_END_RE, 1)[0] ?? ''
}

/** Why `prompt` may not be a job's prompt, or undefined when it may: a prompt that is not a slash
 *  command always may. Nobody is there to approve a run, so a command that changes anything (an
 *  order, the book, settings) is refused; only a read, or one that spends on a model, is let through.
 *  The command is the prompt's first line: an event job's run appends the alert after it. */
export function scheduledCommandRefusal(
  dispatcher: Pick<SlashDispatcher, 'resolve'>,
  prompt: string
): ScheduledCommandRefusal | undefined {
  const line = scheduledCommandLine(prompt)
  const command = commandHeadOf(line)

  if (command === null) {
    return undefined
  }

  const params = { command }
  const resolved = dispatcher.resolve(line)

  if (resolved === null) {
    return {
      message: `${command} is not a command`,
      operator: { key: 'errors.jobCommandUnknown', params },
    }
  }

  const { action, surfaces } = resolved.policy

  return action === 'mutate' || !surfaces.includes(SCHEDULED_COMMAND_SURFACE)
    ? {
        message: `${command} changes state or needs approval, so it cannot run unattended`,
        operator: { key: 'errors.jobCommandUnattended', params },
      }
    : undefined
}
