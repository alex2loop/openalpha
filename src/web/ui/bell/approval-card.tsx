import { type Signal, useSignal, useSignalEffect } from '@preact/signals'
import { useRef } from 'preact/hooks'

import type { Decision } from '@/app/server/wire/chat'
import type { WireEvent } from '@/app/server/wire/events'
import type { PendingWire, QuestionPendingWire } from '@/app/server/wire/live'
import { approvalDetail } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { answerApproval, answerOnLine, decisionLabel } from '@/web/state/approvals'
import { useNow } from '@/web/state/clock'
import { focusRun } from '@/web/state/focus'
import { findRun } from '@/web/state/live'
import { locale, state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatClock, formatElapsed } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { chosenRequestId, DECISION_KEYS, keyedAnswer } from '@/web/ui/bell/bell-keys'
import { Button } from '@/web/ui/kit/button'

const COUNTDOWN_TICK_MS = 1_000
// Inside this the countdown turns Caution.
const EXPIRY_NEAR_MS = 30_000
const DECISION_KINDS = Object.freeze({
  approve: 'commit',
  always: 'secondary',
  deny: 'destructive',
} as const satisfies Record<Decision, 'commit' | 'secondary' | 'destructive'>)

type Outcome = 'approved' | 'denied'

interface Asker {
  readonly who: string
  readonly sourceLine: string
}

/** One request waiting for the operator. Only one asked on this page can be answered here; any
 *  other names where it is answered instead. */
export function PendingCard({ entry }: { readonly entry: PendingWire }) {
  return entry.kind === 'approval' ? (
    <ApprovalCard event={entry.event} />
  ) : (
    <QuestionCard question={entry} />
  )
}

function ApprovalCard({ event }: { readonly event: WireEvent }) {
  const { approval, requestId } = event

  if (approval === undefined || requestId === undefined) {
    return null
  }

  const channelId = approval.channelId ?? event.source.channel
  const asker = resolveAsker(event.runId, {
    agentId: event.source.agentId,
    channelId,
    askedAt: approval.askedAt,
  })
  const detail = approvalDetail(locale.value, approval.argsSummary, approval.truncated)

  return (
    <div class={chosenRequestId.value === requestId ? 'pending-card is-chosen' : 'pending-card'}>
      <div class="pending-card-head">
        <b>{joinInline([asker.who, approval.label])}</b>
        <Countdown expiresAt={approval.expiresAt} />
      </div>
      {approval.dangerous === true && (
        <span class="pending-tag">{tr('ui.office.bell.dangerTag')}</span>
      )}
      {detail !== undefined && detail !== '' && <p class="mono pending-card-arg">{detail}</p>}
      <p class="meta">{asker.sourceLine}</p>
      {event.runId !== undefined && <SeeRun runId={event.runId} />}
      {approval.answerable === true ? (
        <Decisions requestId={requestId} decisions={approval.decisions} />
      ) : (
        <p class="pending-card-elsewhere">{answerOnLine(channelId)}</p>
      )}
    </div>
  )
}

// "Xem": the run behind the request comes into view in the office.
function SeeRun({ runId }: { readonly runId: string }) {
  return (
    <Button kind="tertiary" size="small" onClick={() => focusRun(runId)}>
      {tr('ui.office.common.view')}
    </Button>
  )
}

function QuestionCard({ question }: { readonly question: QuestionPendingWire }) {
  const asker = resolveAsker(question.runId, {
    agentId: undefined,
    channelId: question.channelId,
    askedAt: question.askedAt,
  })

  return (
    <div class="pending-card">
      <div class="pending-card-head">
        <b>{joinInline([asker.who, tr('ui.office.bell.question')])}</b>
      </div>
      <p class="pending-card-arg">{question.question}</p>
      <p class="meta">{asker.sourceLine}</p>
      <p class="pending-card-elsewhere">
        {question.answerable ? tr('ui.office.bell.answerInChat') : answerOnLine(question.channelId)}
      </p>
    </div>
  )
}

function Countdown({ expiresAt }: { readonly expiresAt: number }) {
  const leftMs = expiresAt - useNow(COUNTDOWN_TICK_MS).value

  return (
    <span class={leftMs <= EXPIRY_NEAR_MS ? 'countdown is-near' : 'countdown'}>
      {tr('ui.office.bell.countdown', { time: formatElapsed(leftMs) })}
    </span>
  )
}

interface DecisionsProps {
  readonly requestId: string
  readonly decisions: readonly Decision[]
}

// The answer is sent once; the card itself leaves only on the daemon's `approval_resolved`.
function Decisions({ requestId, decisions }: DecisionsProps) {
  const outcome = useSignal<Outcome | undefined>(undefined)
  const failure = useSignal<string | undefined>(undefined)
  const isBusy = useSignal(false)
  const isChosen = chosenRequestId.value === requestId

  useKeyedAnswer({ requestId, decisions, isBusy, outcome, failure })

  if (outcome.value !== undefined) {
    return <p class="pending-card-outcome">{tr(`ui.office.bell.${outcome.value}`)}</p>
  }

  return (
    <>
      <div class="pending-card-actions">
        {decisions.map((decision) => (
          <Button
            key={decision}
            kind={DECISION_KINDS[decision]}
            size="small"
            disabled={isBusy.value}
            onClick={() => answer({ requestId, decision, isBusy, outcome, failure })}
          >
            {isChosen && decision !== 'always'
              ? tr('ui.office.keys.onButton', {
                  label: decisionLabel(decision),
                  key: DECISION_KEYS[decision],
                })
              : decisionLabel(decision)}
          </Button>
        ))}
      </div>
      {failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value}
        </p>
      )}
    </>
  )
}

// Y or N on this outlined card answers it like its button would, once; a press made before the
// card mounted is never taken.
function useKeyedAnswer(input: Omit<AnswerInput, 'decision'> & DecisionsProps): void {
  const handledSeq = useRef(keyedAnswer.peek()?.seq)

  useSignalEffect(() => {
    const press = keyedAnswer.value

    if (press === undefined || press.seq === handledSeq.current) {
      return
    }

    handledSeq.current = press.seq

    const isOpen = input.outcome.peek() === undefined && !input.isBusy.peek()

    if (press.requestId === input.requestId && isOpen && input.decisions.includes(press.decision)) {
      answer({ ...input, decision: press.decision })
    }
  })
}

interface AnswerInput {
  readonly requestId: string
  readonly decision: Decision
  readonly isBusy: Signal<boolean>
  readonly outcome: Signal<Outcome | undefined>
  readonly failure: Signal<string | undefined>
}

function answer({ requestId, decision, isBusy, outcome, failure }: AnswerInput): void {
  isBusy.value = true
  failure.value = undefined
  answerApproval(requestId, decision)
    .then(
      () => {
        outcome.value = decision === 'deny' ? 'denied' : 'approved'
      },
      (error: unknown) => {
        // A `conflict` carries the daemon's sentence: answered elsewhere, or asked on another channel.
        failure.value = error instanceof ApiFailure ? toFailureText(error) : undefined
      }
    )
    .finally(() => {
      isBusy.value = false
    })
}

interface AskerInput {
  readonly agentId: string | undefined
  readonly channelId: string
  readonly askedAt: number | undefined
}

// A delegated child names its role and its parent; anyone else names its agent or its run.
function resolveAsker(runId: string | undefined, input: AskerInput): Asker {
  const run = runId === undefined ? undefined : findRun(runId)
  const parent = run?.parentRunId === undefined ? undefined : findRun(run.parentRunId)
  const timeZone = state.value?.timeZone
  const from =
    input.askedAt === undefined || timeZone === undefined
      ? sourceLabel(input.channelId)
      : tr('ui.office.bell.from', {
          channel: sourceLabel(input.channelId),
          time: formatClock(input.askedAt, timeZone),
        })

  if (run?.parentRunId !== undefined) {
    const role = run.title ?? run.name
    const childOf =
      parent === undefined ? [] : [tr('ui.office.bell.childOf', { parent: formatRunName(parent) })]

    return { who: tr('ui.office.bell.child', { role }), sourceLine: joinInline([...childOf, from]) }
  }

  // The app's own requests carry an empty agent id.
  const agentId = input.agentId === '' ? undefined : input.agentId

  return {
    who: agentId ?? run?.agentId ?? run?.name ?? sourceLabel(input.channelId),
    sourceLine: from,
  }
}
