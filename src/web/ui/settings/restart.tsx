import { type Signal, signal } from '@preact/signals'

import type { RestartWhen } from '@/app/server/wire/vocab'
import { pluralKey } from '@/i18n'
import { APPROVAL_KIND, pending, runningCount } from '@/web/state/live'
import { dismissRestart, requestRestart, restartPhase } from '@/web/state/restart'
import { state } from '@/web/state/session'
import { pendingRestart, type RestartRow, type SettingsSection } from '@/web/state/settings'
import { MS_PER_MINUTE } from '@/web/text/time-units'
import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'
import { describeRows, sectionOfRows } from '@/web/ui/settings/restart-rows'

import '@/web/ui/dialogs/dialogs.css'

interface RestartRequest {
  /** Leads back to Cài đặt, where the dialog was opened from. */
  readonly onBack?: () => void
}

interface OpenRestart {
  readonly request: RestartRequest
  readonly when: Signal<RestartWhen>
  readonly failure: Signal<string | undefined>
  readonly isBusy: Signal<boolean>
  handle?: ModalHandle
}

/** "Khởi động lại daemon": what will apply, what is running, and whether to wait for it. A daemon
 *  that cannot restart (a terminal on Windows) is told how to instead. */
export function openRestartDialog(request: RestartRequest): void {
  const open: OpenRestart = {
    request,
    when: signal('idle'),
    failure: signal(undefined),
    isBusy: signal(false),
  }

  open.handle = openModal({
    title: tr('ui.office.restart.title'),
    body: <RestartBody open={open} />,
    footer: <RestartFooter open={open} />,
  })
}

function RestartBody({ open }: { readonly open: OpenRestart }) {
  const rows = pendingRestart.value
  const running = runningCount.value
  const approvals = pending.value.filter((entry) => entry.kind === APPROVAL_KIND).length

  return (
    <div class="dialog-form">
      {rows.length > 0 && <p>{tr('ui.office.restart.applies', { keys: describeRows(rows) })}</p>}
      {state.value?.restartable === true ? (
        <>
          {running > 0 && (
            <p class="meta">
              {tr(pluralKey(running, 'ui.office.header.runningOne', 'ui.office.header.running'), {
                count: running,
              })}
            </p>
          )}
          <WhenChoice open={open} />
          {approvals > 0 && (
            <p class="meta">
              {tr(
                pluralKey(
                  approvals,
                  'ui.office.restart.approvalsOne',
                  'ui.office.restart.approvals'
                ),
                { count: approvals }
              )}
            </p>
          )}
        </>
      ) : (
        <p>{tr('errors.restartForeground')}</p>
      )}
      {open.failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {open.failure.value}
        </p>
      )}
    </div>
  )
}

function WhenChoice({ open }: { readonly open: OpenRestart }) {
  const minutes = Math.max(1, Math.round((state.value?.restartIdleWaitMs ?? 0) / MS_PER_MINUTE))
  const choices: readonly { readonly value: RestartWhen; readonly label: string }[] = [
    { value: 'idle', label: tr('ui.office.restart.idle', { minutes }) },
    { value: 'now', label: tr('ui.office.restart.now') },
  ]

  return (
    <fieldset class="form-field">
      {choices.map((choice) => (
        <label key={choice.value} class="form-check">
          <input
            type="radio"
            name="restart-when"
            checked={open.when.value === choice.value}
            onChange={() => {
              open.when.value = choice.value
            }}
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  )
}

function RestartFooter({ open }: { readonly open: OpenRestart }) {
  const { onBack } = open.request

  return (
    <>
      <div class="dialog-foot-left">
        {onBack !== undefined && (
          <Button onClick={onBack}>{tr('ui.office.settings.toSettings')}</Button>
        )}
      </div>
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
      {state.value?.restartable === true && (
        <Button kind="commit" disabled={open.isBusy.value} onClick={() => confirm(open)}>
          {tr('ui.office.restart.confirm')}
        </Button>
      )}
    </>
  )
}

function confirm(open: OpenRestart): void {
  open.isBusy.value = true
  open.failure.value = undefined
  requestRestart(open.when.value)
    .then(() => open.handle?.close())
    .catch((error: unknown) => {
      open.failure.value = toErrorText(error)
    })
    .finally(() => {
      open.isBusy.value = false
    })
}

/** The restart the page asked for, as a line over the stage: waiting for the daemon, what was
 *  applied once it is back, or that it did not come back. */
export function RestartStatus({ onSee }: { readonly onSee: (section: SettingsSection) => void }) {
  const phase = restartPhase.value

  switch (phase?.kind) {
    case undefined:
      return null
    case 'waiting':
      return <WaitingLine refused={phase.refusedApprovals} />
    case 'done':
      return <DoneLine note={phase.note} applied={phase.applied} onSee={onSee} />
    case 'failed':
      return <FailedLine detail={phase.note === '' ? tr('ui.restartFailed') : phase.note} />
    case 'timedOut':
      return <FailedLine detail={tr('ui.office.restart.failedBody')} />
  }
}

interface DoneLineProps {
  /** The daemon's own line; empty when it sent none. */
  readonly note: string
  readonly applied: readonly RestartRow[]
  readonly onSee: (section: SettingsSection) => void
}

function DoneLine({ note, applied, onSee }: DoneLineProps) {
  const section = sectionOfRows(applied)

  return (
    <div class="offline-bar" role="status">
      <strong>{note === '' ? tr('ui.restartDone') : note}</strong>
      {applied.length > 0 && (
        <span class="offline-bar-detail">
          {tr('ui.office.restart.applied', { keys: describeRows(applied) })}
        </span>
      )}
      {section !== undefined && (
        <Button size="small" onClick={() => onSee(section)}>
          {tr('ui.office.restart.seeSettings')}
        </Button>
      )}
      <Button size="small" onClick={dismissRestart}>
        {tr('ui.office.restart.understood')}
      </Button>
    </div>
  )
}

function FailedLine({ detail }: { readonly detail: string }) {
  return (
    <div class="offline-bar" role="alert">
      <strong>{tr('ui.office.restart.failed')}</strong>
      <span class="offline-bar-detail">{detail}</span>
      <Button size="small" onClick={dismissRestart}>
        {tr('ui.office.restart.understood')}
      </Button>
    </div>
  )
}

function WaitingLine({ refused }: { readonly refused: number }) {
  return (
    <div class="offline-bar" role="status">
      <strong>{tr('ui.office.offline.restarting')}</strong>
      <span class="offline-bar-detail">{tr('ui.office.restart.running')}</span>
      {refused > 0 && (
        <span class="offline-bar-detail">
          {tr(pluralKey(refused, 'ui.office.restart.approvalsOne', 'ui.office.restart.approvals'), {
            count: refused,
          })}
        </span>
      )}
    </div>
  )
}
