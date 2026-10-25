import { type Signal, signal } from '@preact/signals'

import type { Run } from '@/web/state/live'
import { ApiFailure } from '@/web/api/client'
import { stopRun } from '@/web/state/approvals'
import { useNow } from '@/web/state/clock'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatElapsed } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

const ELAPSED_TICK_MS = 1_000

interface JobRowProps {
  readonly run: Run
  readonly childRuns: readonly Run[]
}

/** A running run: what, who, its step, how long, where from, and "Dừng", which asks first. A
 *  parent lists its children under it. */
export function JobRow({ run, childRuns }: JobRowProps) {
  const now = useNow(ELAPSED_TICK_MS).value

  return (
    <div class="job-row">
      <span class="spin" aria-hidden="true" />
      <div class="job-main">
        <b>
          {joinInline([formatRunName(run), ...(run.agentId === undefined ? [] : [run.agentId])])}
        </b>
        <p class="meta">
          {joinInline([
            ...(run.progress === undefined ? [] : [run.progress.text]),
            formatElapsed(now - run.startedAt),
            sourceLabel(run.channelId),
          ])}
        </p>
        {childRuns.map((child) => (
          <p key={child.runId} class="meta job-child">
            {joinInline([
              formatRunName(child),
              ...(child.progress === undefined ? [] : [child.progress.text]),
            ])}
          </p>
        ))}
      </div>
      <Button kind="destructive" size="small" onClick={() => askStop(run, childRuns.length > 0)}>
        {tr('ui.office.common.stop')}
      </Button>
    </div>
  )
}

interface StopDialog {
  readonly isBusy: Signal<boolean>
  readonly failure: Signal<string | undefined>
  handle?: ModalHandle
}

// "Chạy tiếp" is the safe, main button, so Enter keeps the run going.
function askStop(run: Run, hasChildren: boolean): void {
  const dialog: StopDialog = { isBusy: signal(false), failure: signal(undefined) }
  const who = run.agentId ?? formatRunName(run)

  dialog.handle = openModal({
    title: tr('ui.office.jobs.stopAsk', { what: formatRunName(run) }),
    body: <StopBody who={who} hasChildren={hasChildren} failure={dialog.failure} />,
    footer: <StopFooter dialog={dialog} runId={run.runId} />,
  })
}

interface StopBodyProps {
  readonly who: string
  readonly hasChildren: boolean
  readonly failure: Signal<string | undefined>
}

function StopBody({ who, hasChildren, failure }: StopBodyProps) {
  return (
    <>
      <p>{tr('ui.office.jobs.stopBody', { who })}</p>
      {hasChildren && <p class="meta stop-children">{tr('ui.office.common.stopChildren')}</p>}
      {failure.value !== undefined && (
        <p class="failure-line stop-failure" role="alert">
          {failure.value}
        </p>
      )}
    </>
  )
}

function StopFooter({ dialog, runId }: { readonly dialog: StopDialog; readonly runId: string }) {
  return (
    <>
      <Button
        kind="destructive"
        disabled={dialog.isBusy.value}
        onClick={() => confirmStop(dialog, runId)}
      >
        {tr('ui.office.common.stop')}
      </Button>
      <Button kind="commit" onClick={() => dialog.handle?.close()}>
        {tr('ui.office.common.keepGoing')}
      </Button>
    </>
  )
}

// A refused stop keeps the dialog open with the daemon's own sentence.
function confirmStop(dialog: StopDialog, runId: string): void {
  dialog.isBusy.value = true
  dialog.failure.value = undefined
  stopRun(runId)
    .then(
      () => dialog.handle?.close(),
      (error: unknown) => {
        dialog.failure.value = error instanceof ApiFailure ? toFailureText(error) : undefined
      }
    )
    .finally(() => {
      dialog.isBusy.value = false
    })
}
