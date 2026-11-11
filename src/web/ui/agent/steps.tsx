import type { ProgressWire } from '@/app/server/wire/live'
import { ELAPSED_TICK_MS, useLiveNow } from '@/web/state/clock'
import { type Run, staleSince } from '@/web/state/live'
import { state } from '@/web/state/session'
import { formatClock, formatElapsed } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { CheckIcon } from '@/web/ui/kit/icons'

/** The steps a run reported: each persistent one done, the latest line running with how long it has
 *  run. Only what the daemon said, as it said it; nothing ahead of it. */
export function StepList({ run }: { readonly run: Pick<Run, 'persistent' | 'progress'> }) {
  const running = resolveRunning(run)

  return (
    <ol class="run-steps">
      {run.persistent.map((step) => (
        <li key={`${step.at}:${step.key}`} class="run-step is-done">
          <CheckIcon />
          <span>{step.text}</span>
        </li>
      ))}
      {running !== undefined && <RunningStep step={running} />}
    </ol>
  )
}

function RunningStep({ step }: { readonly step: ProgressWire }) {
  const now = useLiveNow(ELAPSED_TICK_MS).value

  return (
    <li class="run-step is-running">
      <span class="spin" aria-hidden="true" />
      <span>
        {step.text}
        <span class="meta run-step-time">{describeStepTime(formatElapsed(now - step.at))}</span>
      </span>
    </li>
  )
}

// While the picture is stale the clock is frozen at the last instant it was known, and says so.
function describeStepTime(elapsed: string): string {
  const since = staleSince.value
  const timeZone = state.value?.timeZone

  if (since === undefined || timeZone === undefined) {
    return tr('ui.office.agent.stepRunning', { elapsed })
  }

  return tr('ui.office.stale.step', { elapsed, time: formatClock(since, timeZone) })
}

// The latest line, unless it is the persistent step already listed as done.
function resolveRunning(run: Pick<Run, 'persistent' | 'progress'>): ProgressWire | undefined {
  const { progress } = run
  const last = run.persistent.at(-1)

  if (progress === undefined) {
    return undefined
  }

  const isListed = last !== undefined && last.at === progress.at && last.key === progress.key

  return isListed ? undefined : progress
}
