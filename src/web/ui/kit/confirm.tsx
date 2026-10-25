import { type Signal, signal } from '@preact/signals'

import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

interface ConfirmSpec {
  readonly title: string
  /** What is kept and what is lost: the first line leads, the rest read as notes. */
  readonly lines: readonly string[]
  readonly confirmLabel: string
  /** A destructive confirm makes "keep" the main button, so Enter loses nothing. */
  readonly isDestructive?: true
  readonly keepLabel?: string
  /** Throws `ApiFailure` to keep the dialog open with the daemon's sentence. */
  readonly confirm: () => Promise<void> | void
}

interface ConfirmDialog {
  readonly spec: ConfirmSpec
  readonly isBusy: Signal<boolean>
  readonly failure: Signal<string | undefined>
  handle?: ModalHandle
}

/** Asks before an action that stops or replaces something; closes once the action succeeds. */
export function askConfirm(spec: ConfirmSpec): void {
  const dialog: ConfirmDialog = { spec, isBusy: signal(false), failure: signal(undefined) }

  dialog.handle = openModal({
    title: spec.title,
    body: <ConfirmBody dialog={dialog} />,
    footer: <ConfirmFooter dialog={dialog} />,
  })
}

function ConfirmBody({ dialog }: { readonly dialog: ConfirmDialog }) {
  const [lead, ...notes] = dialog.spec.lines

  return (
    <>
      {lead !== undefined && <p>{lead}</p>}
      {notes.map((note) => (
        <p key={note} class="meta confirm-note">
          {note}
        </p>
      ))}
      {dialog.failure.value !== undefined && (
        <p class="failure-line confirm-note" role="alert">
          {dialog.failure.value}
        </p>
      )}
    </>
  )
}

function ConfirmFooter({ dialog }: { readonly dialog: ConfirmDialog }) {
  const { spec } = dialog
  const isDestructive = spec.isDestructive === true

  return (
    <>
      <Button
        kind={isDestructive ? 'destructive' : 'commit'}
        disabled={dialog.isBusy.value}
        onClick={() => runConfirm(dialog)}
      >
        {spec.confirmLabel}
      </Button>
      <Button kind={isDestructive ? 'commit' : 'secondary'} onClick={() => dialog.handle?.close()}>
        {spec.keepLabel ?? tr('ui.office.common.cancel')}
      </Button>
    </>
  )
}

function runConfirm(dialog: ConfirmDialog): void {
  dialog.isBusy.value = true
  dialog.failure.value = undefined
  Promise.resolve()
    .then(dialog.spec.confirm)
    .then(
      () => dialog.handle?.close(),
      (error: unknown) => {
        dialog.failure.value = toErrorText(error)
      }
    )
    .finally(() => {
      dialog.isBusy.value = false
    })
}
