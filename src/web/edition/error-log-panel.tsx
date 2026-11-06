import { useSignal } from '@preact/signals'

import { clearErrorLog, type ErrorLogEntry, errorLog } from '@/web/edition/error-log'
import { state } from '@/web/state/session'
import { formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { CopyButton } from '@/web/ui/kit/copy-button'

/** Nhật ký lỗi: what went wrong in this tab, newest first, to read or copy into a report. */
export function ErrorLogPanel() {
  const isCopyRefused = useSignal(false)
  const newest = [...errorLog.value].reverse()

  return (
    <>
      <p class="meta">{tr('ui.office.edition.errorLog.note')}</p>
      <EntryList entries={newest} />
      <div class="setting-actions">
        <CopyButton
          text={newest.map(toCopyLine).join('\n')}
          label={tr('ui.office.edition.errorLog.copy')}
          onRefused={() => {
            isCopyRefused.value = true
          }}
        />
        <Button
          size="small"
          disabled={newest.length === 0}
          onClick={() => {
            isCopyRefused.value = false
            clearErrorLog()
          }}
        >
          {tr('ui.office.edition.errorLog.clear')}
        </Button>
      </div>
      {isCopyRefused.value && (
        <p class="failure-line">{tr('ui.office.edition.errorLog.copyFailed')}</p>
      )}
    </>
  )
}

function EntryList({ entries }: { readonly entries: readonly ErrorLogEntry[] }) {
  const timeZone = state.value?.timeZone

  if (entries.length === 0) {
    return <p>{tr('ui.office.edition.errorLog.empty')}</p>
  }

  return (
    <ol class="error-log">
      {entries.map((entry) => (
        <li key={`${entry.time}-${entry.key}`}>
          <span class="meta">{timeZone === undefined ? '' : formatWhen(entry.time, timeZone)}</span>{' '}
          <strong>{entry.level}</strong> {entry.key} <span class="meta">{toFieldsText(entry)}</span>
        </li>
      ))}
    </ol>
  )
}

function toCopyLine(entry: ErrorLogEntry): string {
  return `${new Date(entry.time).toISOString()} ${entry.level} ${entry.key} ${toFieldsText(entry)}`.trimEnd()
}

function toFieldsText({ fields }: ErrorLogEntry): string {
  return Object.keys(fields).length === 0 ? '' : JSON.stringify(fields)
}
