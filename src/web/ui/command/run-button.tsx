import { isRunningCommand, runCommand } from '@/web/state/command'
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
}

/** Sends `command` at once, then spins and waits while that run is under way, so a second press
 *  never queues a second run. */
export function RunButton(props: RunButtonProps) {
  const { command, label, busyLabel, kind, size, disabled, onRun } = props
  const isRunning = isRunningCommand(command)

  return (
    <Button
      {...(kind === undefined ? {} : { kind })}
      {...(size === undefined ? {} : { size })}
      disabled={disabled === true || isRunning}
      onClick={() => {
        onRun?.()
        runCommand(command)
      }}
    >
      {isRunning && <span class="spin" aria-hidden="true" />}
      {isRunning && busyLabel !== undefined ? busyLabel : label}
    </Button>
  )
}
