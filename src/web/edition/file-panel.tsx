import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'

import type { DbOpenOutcome } from '@/app/server/wire/worker'
import type { MessageKey } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { downloadBlob } from '@/web/edition/download'
import {
  canPickSaveFile,
  chooseSaveFile,
  forgetSaveFile,
  resumeSaveFile,
  type SaveStatus,
  SQLITE_MIME,
  saveStatus,
  suggestedFileName,
} from '@/web/edition/file-save'
import { cliName } from '@/web/edition/guide/product'
import { requestDbExport, requestDbOpen } from '@/web/edition/worker-link'
import { state } from '@/web/state/session'
import { formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { ActionRow, type SectionProps } from '@/web/ui/settings/row'

const OPEN_REFUSAL: Readonly<Record<Exclude<DbOpenOutcome, 'opened'>, MessageKey>> = Object.freeze({
  invalid: 'ui.office.edition.file.open.invalid',
  'newer-schema': 'ui.office.edition.file.open.newer',
  'from-installed': 'ui.office.edition.file.open.installed',
  'storage-full': 'ui.office.edition.file.open.full',
  failed: 'ui.office.edition.file.open.failed',
})

/** Lưu vào file, xuất, mở file and chuyển sang bản cài: the ways the visitor's data leaves the
 *  browser's private storage or comes back into it. */
export function FilePanel({ reopen }: SectionProps) {
  return (
    <>
      {canPickSaveFile() && <SaveRow />}
      <ExportRow />
      <OpenRow reopen={reopen} />
      <MoveRow />
    </>
  )
}

function SaveRow() {
  const status = saveStatus.value
  const failure = useSignal<string | undefined>(undefined)
  const run = (action: () => Promise<void>): void => {
    failure.value = undefined
    action().catch(() => {
      failure.value = tr('ui.office.edition.file.save.pickFailed')
    })
  }

  return (
    <ActionRow
      title={tr('ui.office.edition.file.save.title')}
      summary={toSaveSummary(status)}
      note={failure.value ?? tr('ui.office.edition.file.save.note')}
    >
      {status.kind === 'paused' ? (
        <Button size="small" kind="commit" onClick={() => run(resumeSaveFile)}>
          {tr('ui.office.edition.file.save.resume')}
        </Button>
      ) : (
        <Button size="small" onClick={() => run(chooseSaveFile)}>
          {tr(
            status.kind === 'none'
              ? 'ui.office.edition.file.save.choose'
              : 'ui.office.edition.file.save.change'
          )}
        </Button>
      )}
      {status.kind !== 'none' && (
        <Button size="small" kind="ghost" onClick={() => run(forgetSaveFile)}>
          {tr('ui.office.edition.file.save.stop')}
        </Button>
      )}
    </ActionRow>
  )
}

function toSaveSummary(status: SaveStatus): string {
  const timeZone = state.value?.timeZone

  switch (status.kind) {
    case 'none':
      return ''
    case 'paused':
      return tr(
        status.failed ? 'ui.office.edition.file.save.failed' : 'ui.office.edition.file.save.paused',
        { name: status.name }
      )
    case 'active':
      return status.savedAt === undefined || timeZone === undefined
        ? tr('ui.office.edition.file.save.active', { name: status.name })
        : tr('ui.office.edition.file.save.activeAt', {
            name: status.name,
            time: formatWhen(status.savedAt, timeZone),
          })
  }
}

function ExportRow() {
  return (
    <ExportAction
      title={tr('ui.office.edition.file.export.title')}
      note={tr('ui.office.edition.file.export.note')}
      button={tr('ui.office.edition.file.export.button')}
    />
  )
}

function MoveRow() {
  return (
    <ExportAction
      title={tr('ui.office.edition.file.move.title')}
      note={tr('ui.office.edition.file.move.note')}
      button={tr('ui.office.edition.file.move.button')}
      command={tr('ui.office.edition.file.move.command', { cliName: cliName() })}
    />
  )
}

interface ExportActionProps {
  readonly title: string
  readonly note: string
  readonly button: string
  /** What to run on the machine the file goes to. */
  readonly command?: string
}

function ExportAction({ title, note, button, command }: ExportActionProps) {
  const failure = useSignal<string | undefined>(undefined)
  const isBusy = useSignal(false)

  return (
    <ActionRow title={title} note={failure.value ?? note}>
      {command !== undefined && <code class="install-line">{command}</code>}
      <Button
        size="small"
        disabled={isBusy.value}
        onClick={() => {
          failure.value = undefined
          isBusy.value = true
          downloadDatabase()
            .catch(() => {
              failure.value = tr('ui.office.edition.file.export.failed')
            })
            .finally(() => {
              isBusy.value = false
            })
        }}
      >
        {button}
      </Button>
    </ActionRow>
  )
}

async function downloadDatabase(): Promise<void> {
  const bytes = await requestDbExport()

  await downloadBlob(new Blob([bytes], { type: SQLITE_MIME }), suggestedFileName())
}

function OpenRow({ reopen }: SectionProps) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <ActionRow
      title={tr('ui.office.edition.file.open.title')}
      note={tr('ui.office.edition.file.open.note')}
    >
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]

          event.currentTarget.value = ''

          if (file !== undefined) {
            askOpen(file, reopen)
          }
        }}
      />
      <Button size="small" onClick={() => input.current?.click()}>
        {tr('ui.office.edition.file.open.button')}
      </Button>
    </ActionRow>
  )
}

function askOpen(file: File, reopen: () => void): void {
  const isSaving = saveStatus.peek().kind !== 'none'

  askConfirm({
    title: tr('ui.office.edition.file.open.ask'),
    lines: [
      tr('ui.office.edition.file.open.body', { name: file.name }),
      ...(isSaving ? [tr('ui.office.edition.file.open.autosave')] : []),
    ],
    confirmLabel: tr('ui.office.edition.file.open.confirm'),
    keepLabel: tr('ui.office.edition.common.keep'),
    isDestructive: true,
    onBack: reopen,
    confirm: () => openFile(file),
  })
}

async function openFile(file: File): Promise<void> {
  let outcome: DbOpenOutcome

  try {
    outcome = await requestDbOpen(await file.arrayBuffer())
  } catch {
    outcome = 'failed'
  }

  if (outcome !== 'opened') {
    throw new ApiFailure(0, 'generic', { message: tr(OPEN_REFUSAL[outcome]) })
  }
}
