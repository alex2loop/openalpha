import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { onWireEvent } from '@/web/state/events'
import { type Run, runs } from '@/web/state/live'
import { state } from '@/web/state/session'
import { childOutcomeKey } from '@/web/text/child-outcome'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { MS_PER_MINUTE } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { StepList } from '@/web/ui/agent/steps'
import { askStop } from '@/web/ui/kit/ask-stop'
import { Button } from '@/web/ui/kit/button'

// More children than one parent run shows; the oldest leave first.
const MAX_CHILDREN = 20

/** A child as last seen, with how it ended once it has. */
interface Child {
  readonly run: Run
  readonly outcome?: string
}

interface ChildNestProps {
  readonly parent: Run
  readonly maxSpawn: number | undefined
}

/** The temporary child agents a run handed work to: each with its goal and steps, and why it did
 *  not finish when it did not. Their cost counts to the parent. */
export function ChildNest({ parent, maxSpawn }: ChildNestProps) {
  const children = useChildren(parent.runId)
  const count = children.length

  if (count === 0) {
    return null
  }

  return (
    <section class="agent-section">
      <p class="run-step is-running">
        {tr(pluralKey(count, 'ui.office.agent.childrenOne', 'ui.office.agent.children'), { count })}
      </p>
      {children.map((child) => (
        <ChildRow key={child.run.runId} child={child} />
      ))}
      <p class="meta">
        {tr(pluralKey(count, 'ui.office.agent.childrenLimitOne', 'ui.office.agent.childrenLimit'), {
          count,
          max: maxSpawn ?? ABSENT_CELL,
          depth: countLevels(children),
          minutes: formatMinutes(state.value?.childRunMaxMs),
        })}
      </p>
      <Button kind="destructive" size="small" onClick={() => askStop(parent, true)}>
        {tr('ui.office.agent.childrenStop')}
      </Button>
    </section>
  )
}

function ChildRow({ child }: { readonly child: Child }) {
  const reason = child.outcome === undefined ? undefined : childOutcomeKey(child.outcome)

  return (
    <div class="child">
      <p class="meta">
        <b class="child-name">{formatRunName(child.run)}</b>
        <span class="agent-tag">{tr('ui.office.common.temp')}</span>
        {reason !== undefined && <span class="agent-tag is-caution">{tr(reason)}</span>}
      </p>
      <StepList
        run={child.outcome === undefined ? child.run : { persistent: child.run.persistent }}
      />
    </div>
  )
}

// A child leaves the live feed when it ends; the nest keeps it, with its outcome, while it shows.
function useChildren(parentRunId: string): readonly Child[] {
  const seen = useRef(new Map<string, Run>())
  const ended = useSignal<ReadonlyMap<string, string>>(new Map())
  const live = runs.value.filter((run) => run.parentRunId === parentRunId)

  for (const run of live) {
    remember(seen.current, run)
  }

  useEffect(() => onWireEvent('run_finished', (event) => noteEnded(seen.current, ended, event)), [])

  return [...seen.current.values()].map((run) => {
    const outcome = ended.value.get(run.runId)

    return outcome === undefined ? { run } : { run, outcome }
  })
}

function remember(seen: Map<string, Run>, run: Run): void {
  seen.delete(run.runId)
  seen.set(run.runId, run)

  for (const oldest of seen.keys()) {
    if (seen.size <= MAX_CHILDREN) {
      break
    }

    seen.delete(oldest)
  }
}

function noteEnded(
  seen: ReadonlyMap<string, Run>,
  ended: Signal<ReadonlyMap<string, string>>,
  event: { readonly runId?: string; readonly outcome?: string }
): void {
  const { runId, outcome } = event

  if (runId === undefined || outcome === undefined || !seen.has(runId)) {
    return
  }

  const next: readonly (readonly [string, string])[] = [...ended.value, [runId, outcome]]

  ended.value = new Map(next.slice(-MAX_CHILDREN))
}

// Children never start children of their own, so a nest is one level unless the feed says more.
function countLevels(children: readonly Child[]): number {
  const ids = new Set(children.map((child) => child.run.runId))
  const isNested = runs.value.some(
    (run) => run.parentRunId !== undefined && ids.has(run.parentRunId)
  )

  return 1 + Number(isNested)
}

function formatMinutes(spanMs: number | undefined): string | number {
  return spanMs === undefined ? ABSENT_CELL : Math.round(spanMs / MS_PER_MINUTE)
}
