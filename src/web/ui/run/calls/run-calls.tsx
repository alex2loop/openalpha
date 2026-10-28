import { useEffect, useRef } from 'preact/hooks'

import type { RunCallsWire, RunCallWire } from '@/app/server/wire/live'
import { pluralKey } from '@/i18n'
import { useBlockRead } from '@/web/state/block'
import { estimateOf, isNoAi } from '@/web/state/estimates'
import { onWireEvent } from '@/web/state/events'
import { state } from '@/web/state/session'
import { formatUsd } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { formatAgentName } from '@/web/text/run-name'
import { formatClock, formatDuration } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Fold } from '@/web/ui/kit/fold'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { loadCalls } from '@/web/ui/run/calls/load-calls'

import './run-calls.css'

interface RunCallsProps {
  readonly runId: string
  readonly isRunning: boolean
  /** The slash command the run answered, with its slash; its usual cost is the yardstick. */
  readonly command?: string | undefined
}

/** "Lệnh gọi AI": every model call a run and its child runs made, read when the fold opens. A
 *  mount is for one run: key it by `runId`. */
export function RunCalls(props: RunCallsProps) {
  // A command that never bills a model has no calls to list.
  if (props.command !== undefined && isNoAi(props.command)) {
    return null
  }

  return (
    <Fold title={tr('ui.office.calls.title')}>
      <CallsBody {...props} />
    </Fold>
  )
}

function CallsBody({ runId, isRunning, command }: RunCallsProps) {
  const hasEnded = useRef(!isRunning)
  const reading = useBlockRead((abort) => loadCalls(runId, abort, hasEnded.current))

  // A running run read again once it ends, never on a timer.
  useEffect(() => {
    if (!isRunning) {
      return undefined
    }

    return onWireEvent('run_finished', (event) => {
      if (event.runId === runId) {
        hasEnded.current = true
        reading.retry()
      }
    })
  }, [])

  const calls = reading.data

  if (calls === undefined) {
    return reading.state === 'failed' ? (
      <div class="strip is-problem" role="alert">
        <span>{tr('ui.office.calls.failed')}</span>
        <Button size="small" onClick={reading.retry}>
          {tr('ui.office.common.retry')}
        </Button>
      </div>
    ) : (
      <Skeleton lines={2} />
    )
  }

  if (calls.calls.length === 0) {
    return <p class="meta">{tr('ui.office.calls.empty')}</p>
  }

  return <CallList calls={calls} command={command} />
}

function CallList({
  calls,
  command,
}: {
  readonly calls: RunCallsWire
  readonly command: string | undefined
}) {
  const timeZone = state.value?.timeZone
  const slowest = Math.max(...calls.calls.map((call) => call.latencyMs))
  const usual = command === undefined ? undefined : estimateOf(command)?.highUsd

  return (
    <>
      <p class="calls-head">
        {tr(pluralKey(calls.totalCalls, 'ui.office.calls.headOne', 'ui.office.calls.head'), {
          count: calls.totalCalls,
          cost: formatUsd(calls.totalUsd),
          slowest: formatDuration(slowest),
        })}
      </p>
      {usual !== undefined && calls.totalUsd > usual && (
        <p class="meta">{tr('ui.office.calls.overEstimate', { estimate: formatUsd(usual) })}</p>
      )}
      {calls.truncated && (
        <p class="meta">{tr('ui.office.calls.truncated', { count: calls.calls.length })}</p>
      )}
      <ul class="calls-list">
        {calls.calls.map((call, index) => (
          <CallRow
            // A call has no id of its own; the list is replaced whole, never reordered in place.
            key={`${call.at}:${call.runId}:${index}`}
            call={call}
            rootRunId={calls.runId}
            timeZone={timeZone}
          />
        ))}
      </ul>
    </>
  )
}

function CallRow({
  call,
  rootRunId,
  timeZone,
}: {
  readonly call: RunCallWire
  readonly rootRunId: string
  readonly timeZone: string | undefined
}) {
  const kind = tr(`ui.office.calls.kind.${call.kind}`)
  const step = call.runId === rootRunId ? kind : joinInline([formatAgentName(call.agentId), kind])

  return (
    <li class="calls-row">
      <div class="calls-main">
        <b>{step}</b>
        <p class="meta">{joinInline([call.model, call.provider])}</p>
        <p class="meta">{joinInline(describeUsage(call))}</p>
        <p class="meta">{joinInline(describeOutcome(call))}</p>
      </div>
      <span class="calls-side">
        {timeZone !== undefined && <span class="meta">{formatClock(call.at, timeZone)}</span>}
        <span>{formatUsd(call.costUsd)}</span>
      </span>
    </li>
  )
}

function describeUsage(call: RunCallWire): string[] {
  return [
    tr('ui.office.calls.tokens', { input: call.inputTokens, output: call.outputTokens }),
    ...(call.cacheReadTokens + call.cacheWriteTokens === 0
      ? []
      : [tr('ui.office.calls.cache', { cache: call.cacheReadTokens + call.cacheWriteTokens })]),
  ]
}

function describeOutcome(call: RunCallWire): string[] {
  return [
    formatDuration(call.latencyMs),
    tr(`ui.office.calls.outcome.${call.outcome}`),
    ...(call.errorCode === undefined ? [] : [tr(`ui.office.calls.error.${call.errorCode}`)]),
  ]
}
