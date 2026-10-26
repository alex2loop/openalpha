import { canStop, isFinished, steer, stopTurn, type Turn, thread } from '@/web/state/chat'
import { ALERT_CREATE_COMMAND, fillInput, inputText, setInput } from '@/web/state/command'
import { focusRun } from '@/web/state/focus'
import { joinInline } from '@/web/text/glyphs'
import { MS_PER_SECOND } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { resolveCommandLink } from '@/web/ui/chat/command-link'
import { ReplyText } from '@/web/ui/chat/history-message'
import { QueuedCard } from '@/web/ui/chat/queued-card'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { SuggestChip } from '@/web/ui/ticker/suggest-chip'

/** What the operator sent and the card that answers it. */
export function TurnCard({ turn }: { readonly turn: Turn }) {
  if (turn.isSystem === true) {
    return <SystemLine turn={turn} />
  }

  return (
    <>
      <div class="chat-user">{turn.text}</div>
      <AnswerCard turn={turn} />
    </>
  )
}

// The who-chip's switch: the daemon's reply, as one quiet line.
function SystemLine({ turn }: { readonly turn: Turn }) {
  const text = turn.error ?? turn.reply

  return text === '' ? null : <p class="chat-system meta">{text.trim()}</p>
}

function AnswerCard({ turn }: { readonly turn: Turn }) {
  if (turn.status === 'queued') {
    return <QueuedCard turn={turn} />
  }

  if (turn.status === 'error') {
    return (
      <div class="chat-card is-caution" role="alert">
        {turn.error}
      </div>
    )
  }

  return (
    <div class="chat-card">
      {!isFinished(turn) && <RunningStep turn={turn} />}
      <ReplyText text={turn.reply} isProse={turn.kind !== 'slash'} />
      <SteerLine turn={turn} />
      {isFinished(turn) ? <FinishedFoot turn={turn} /> : <RunningActions turn={turn} />}
    </div>
  )
}

function RunningStep({ turn }: { readonly turn: Turn }) {
  const fallback = turn.kind === 'slash' ? 'ui.office.chat.working' : 'ui.office.chat.answering'
  const alongside = resolveAlongside(turn)

  return (
    <>
      <p class="chat-step">
        <span class="spin" aria-hidden="true" />
        <span>{turn.step ?? tr(fallback)}</span>
      </p>
      {alongside !== undefined && (
        <p class="meta">{tr('ui.office.chat.parallel', { what: alongside })}</p>
      )}
    </>
  )
}

// A lane command runs beside the chat's own answer; it names that answer while both run.
function resolveAlongside(turn: Turn): string | undefined {
  if (turn.isInLane === undefined) {
    return undefined
  }

  const head = thread.value.find((held) => held.isInLane === undefined && held.status === 'running')

  return head?.text
}

function SteerLine({ turn }: { readonly turn: Turn }) {
  const note = turn.steer

  if (note === undefined || note.state === 'sending') {
    return null
  }

  if (note.state === 'dropped') {
    return <p class="chat-caution">{note.text}</p>
  }

  return <p class="meta chat-steer">{joinInline([note.text, tr('ui.office.chat.steered')])}</p>
}

function RunningActions({ turn }: { readonly turn: Turn }) {
  const typed = inputText.value.trim()
  const runId = turn.runId

  return (
    <div class="chat-actions">
      {runId !== undefined && (
        <Button kind="tertiary" size="small" onClick={() => focusRun(runId)}>
          {tr('ui.office.chat.seeOffice')}
        </Button>
      )}
      {turn.kind === 'ask' && (
        <Button size="small" disabled={typed === ''} onClick={() => addNote(turn, typed)}>
          {tr('ui.office.chat.addNote')}
        </Button>
      )}
      {canStop(turn) && (
        <Button kind="destructive" size="small" onClick={() => askStopTurn(turn)}>
          {tr('ui.office.common.stop')}
        </Button>
      )}
    </div>
  )
}

function addNote(turn: Turn, typed: string): void {
  if (steer(turn, typed)) {
    setInput('')
  }
}

// A command stops by its run; an agent turn stops what runs in this chat.
function askStopTurn(turn: Turn): void {
  askConfirm({
    title: tr('ui.office.jobs.stopAsk', { what: turn.text }),
    lines: [
      turn.runId === undefined
        ? tr('ui.office.chat.stopCtx')
        : tr('ui.office.jobs.stopBody', { who: turn.text }),
    ],
    confirmLabel: tr('ui.office.common.stop'),
    isDestructive: true,
    keepLabel: tr('ui.office.common.keepGoing'),
    confirm: () => stopTurn(turn),
  })
}

function FinishedFoot({ turn }: { readonly turn: Turn }) {
  if (turn.status === 'dropped' || turn.status === 'stopped') {
    return <p class="meta">{tr(`ui.office.chat.${turn.status}`)}</p>
  }

  const link = resolveCommandLink(turn.text, turn.runId)

  return (
    <>
      {turn.doneAt !== undefined && (
        <p class="meta">
          {tr('ui.office.chat.elapsed', {
            seconds: Math.max(1, Math.ceil((turn.doneAt - turn.sentAt) / MS_PER_SECOND)),
          })}
        </p>
      )}
      <div class="chat-actions">
        {link !== undefined && (
          <Button kind="tertiary" size="small" onClick={link.open}>
            {tr(link.label, link.params)}
          </Button>
        )}
        <NextSteps tickers={turn.tickers} />
      </div>
    </>
  )
}

// The first name the answer reported on: suggest it, or set an alert on it. Both only fill the box.
function NextSteps({ tickers }: { readonly tickers: readonly string[] | undefined }) {
  const ticker = tickers?.[0]

  if (ticker === undefined) {
    return null
  }

  return (
    <>
      <SuggestChip ticker={ticker} />
      <Button size="small" onClick={() => fillInput(`${ALERT_CREATE_COMMAND} ${ticker} `)}>
        {tr('ui.office.common.setAlert')}
      </Button>
    </>
  )
}
