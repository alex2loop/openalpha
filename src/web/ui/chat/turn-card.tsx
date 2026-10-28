import {
  canStop,
  isFinished,
  type SavedPreference,
  steer,
  stopTurn,
  type Turn,
  thread,
} from '@/web/state/chat'
import {
  ALERT_CREATE_COMMAND,
  FORCE_ARG,
  fillInput,
  inputText,
  runCommand,
  SUGGEST_COMMAND,
  setInput,
} from '@/web/state/command'
import { focusRun } from '@/web/state/focus'
import { findRun, hasChildren, type Run, runs } from '@/web/state/live'
import { canRemember, toAttributeName } from '@/web/state/memory'
import { joinInline } from '@/web/text/glyphs'
import { MS_PER_SECOND } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { commandWordOf, commandWordsOf, resolveCommandLink } from '@/web/ui/chat/command-link'
import { RememberThis, ReplyText } from '@/web/ui/chat/history-message'
import { QueuedCard } from '@/web/ui/chat/queued-card'
import { isResearchTurn, ResearchReportLink, ResearchSteps } from '@/web/ui/chat/research-steps'
import { askStop } from '@/web/ui/kit/ask-stop'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { RunCalls } from '@/web/ui/run/calls/run-calls'
import { openSettings } from '@/web/ui/settings/settings'
import { SuggestChip } from '@/web/ui/ticker/suggest-chip'

/** What the operator sent and the card that answers it. */
export function TurnCard({ turn }: { readonly turn: Turn }) {
  if (turn.isSystem === true) {
    return <SystemLine turn={turn} />
  }

  return (
    <>
      <div class="chat-user">{turn.text}</div>
      {isFinished(turn) && canRemember(turn) && <RememberThis text={turn.text} />}
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
      <ReplyText
        text={turn.reply}
        isProse={turn.kind !== 'slash' || isResearchTurn(turn)}
        scope={isResearchTurn(turn) ? turn.localId : undefined}
      />
      <SteerLine turn={turn} />
      <PreferenceLines preferences={turn.preferences} />
      {isFinished(turn) ? <FinishedFoot turn={turn} /> : <RunningActions turn={turn} />}
      {isFinished(turn) && turn.runId !== undefined && (
        <RunCalls
          key={turn.runId}
          runId={turn.runId}
          isRunning={false}
          command={turn.kind === 'slash' ? commandWordOf(turn.text) : undefined}
        />
      )}
    </div>
  )
}

function RunningStep({ turn }: { readonly turn: Turn }) {
  const research = isResearchTurn(turn) ? findTurnRun(turn) : undefined

  if (research !== undefined) {
    return <ResearchSteps runId={research.runId} />
  }

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

// A lane command names its run as it starts; a command handed to an agent runs as its session's
// top agent run, which the daemon names only at the end.
function findTurnRun(turn: Turn): Run | undefined {
  if (turn.runId !== undefined) {
    return findRun(turn.runId)
  }

  if (turn.kind !== 'slash' || turn.isInLane === true || turn.sessionId === undefined) {
    return undefined
  }

  return runs.value.findLast(
    (run) =>
      run.kind === 'agent' && run.parentRunId === undefined && run.sessionId === turn.sessionId
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

// What the chat just learned about the operator, with the way to see all of it.
function PreferenceLines({
  preferences,
}: {
  readonly preferences: readonly SavedPreference[] | undefined
}) {
  if (preferences === undefined || preferences.length === 0) {
    return null
  }

  return (
    <>
      {preferences.map((preference, index) => (
        <p key={index} class="meta">
          {toPreferenceLine(preference)}
        </p>
      ))}
      <div class="chat-actions">
        <Button kind="tertiary" size="small" onClick={() => openSettings('memory')}>
          {tr('ui.office.memory.see')}
        </Button>
      </div>
    </>
  )
}

function toPreferenceLine(preference: SavedPreference): string {
  switch (preference.change) {
    case 'added':
      return tr('ui.office.memory.remembered', { value: preference.value })
    case 'updated':
      return tr('ui.office.memory.updated', { value: preference.value })
    case 'removed':
      return tr('ui.office.memory.removed', { attribute: toAttributeName(preference.attribute) })
  }
}

function RunningActions({ turn }: { readonly turn: Turn }) {
  const typed = inputText.value.trim()
  const runId = turn.runId ?? findTurnRun(turn)?.runId

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
  const run = isResearchTurn(turn) ? findTurnRun(turn) : undefined

  if (run !== undefined) {
    askStop(run, hasChildren(run.runId))
    return
  }

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
        {isResearchTurn(turn) && turn.runId !== undefined && (
          <ResearchReportLink runId={turn.runId} />
        )}
        <NextSteps turn={turn} />
      </div>
    </>
  )
}

// The first name the answer reported on: analyze it, or, under an analysis that may have handed back
// a stored call, analyze it again from scratch; or start an alert on it, which waits in the box for
// its price.
function NextSteps({ turn }: { readonly turn: Turn }) {
  const ticker = turn.tickers?.[0]
  const isSuggest = commandWordOf(turn.text) === SUGGEST_COMMAND
  const isForced = commandWordsOf(turn.text).includes(FORCE_ARG)

  if (ticker === undefined) {
    return null
  }

  return (
    <>
      {!isSuggest && <SuggestChip ticker={ticker} />}
      {isSuggest && !isForced && (
        <Button
          size="small"
          onClick={() => runCommand(`${SUGGEST_COMMAND} ${ticker} ${FORCE_ARG}`)}
        >
          {tr('ui.office.common.suggestFresh')}
        </Button>
      )}
      <Button size="small" onClick={() => fillInput(`${ALERT_CREATE_COMMAND} ${ticker} `)}>
        {tr('ui.office.common.setAlert')}
      </Button>
    </>
  )
}
