import { useSignal } from '@preact/signals'

import { isRunningCommand, runCommand } from '@/web/state/command'
import { sendQuiet } from '@/web/state/quiet-command'
import { tr } from '@/web/text/tr'
import { Button, type ButtonKind, type ButtonSize } from '@/web/ui/kit/button'

interface RunButtonProps {
  /** The command the button sends, as the operator would type it. */
  readonly command: string
  readonly label: string
  /** What it reads while its run is under way; the label stays when absent. */
  readonly busyLabel?: string
  readonly kind?: ButtonKind
  readonly size?: ButtonSize
  /** Holds the button off for a reason of the caller's own, beside its run being under way. */
  readonly disabled?: boolean
  /** Runs just before the command is sent. */
  readonly onRun?: () => void
  /** The caller shows the result where the button sits, so the chat shows nothing of it and only a
   *  refusal is printed under the button. */
  readonly isQuiet?: boolean
}

/** Sends `command` at once, then spins and waits while that run is under way, so a second press
 *  never queues a second run. */
export function RunButton(props: RunButtonProps) {
  const { command, label, busyLabel, kind, size, disabled, isQuiet } = props
  const failure = useSignal<string | undefined>(undefined)
  const isRunning = isRunningCommand(command)

  const run = (): void => {
    props.onRun?.()

    if (isQuiet !== true) {
      runCommand(command)
      return
    }

    failure.value = undefined

    const isSent = sendQuiet({
      text: command,
      onRefused: (message) => {
        failure.value = message
      },
    })

    if (!isSent) {
      failure.value = tr('ui.office.command.offline')
    }
  }

  return (
    <>
      <Button
        {...(kind === undefined ? {} : { kind })}
        {...(size === undefined ? {} : { size })}
        disabled={disabled === true || isRunning}
        onClick={run}
      >
        {isRunning && <span class="spin" aria-hidden="true" />}
        {isRunning && busyLabel !== undefined ? busyLabel : label}
      </Button>
      {failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value}
        </p>
      )}
    </>
  )
}
