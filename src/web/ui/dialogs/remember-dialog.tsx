import { type Signal, signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { type MemoryLimits, readMemoryLimits, rememberNote, toMemoryKey } from '@/web/state/memory'
import { toFailureText, tr } from '@/web/text/tr'
import { describeFailure, type FormFailure } from '@/web/ui/dialogs/field-errors'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'

import './dialogs.css'

const VALUE_ROWS = 3
const FIELDS: readonly string[] = ['key', 'value']

interface RememberStart {
  /** What to remember, filled in from a chat message. */
  readonly value?: string
  /** Leads back to Cài đặt, where it was opened. */
  readonly onBack?: () => void
}

interface OpenRemember {
  readonly start: RememberStart
  readonly value: Signal<string>
  /** The key as the operator typed it; absent while the suggested one stands. */
  readonly typedKey: Signal<string | undefined>
  readonly keyMaxLen: Signal<number | undefined>
  readonly isBusy: Signal<boolean>
  readonly failure: Signal<FormFailure | undefined>
  /** The key saved; the dialog then says so. */
  readonly saved: Signal<string | undefined>
  handle?: ModalHandle
}

/** + Ghi nhớ: a note for the scope the web chat uses, its key suggested from what it says. */
export function openRememberDialog(start: RememberStart = {}): void {
  const open: OpenRemember = {
    start,
    value: signal(start.value ?? ''),
    typedKey: signal(undefined),
    keyMaxLen: signal(undefined),
    isBusy: signal(false),
    failure: signal(undefined),
    saved: signal(undefined),
  }

  open.handle = openModal({
    title: tr('ui.office.memory.addTitle'),
    body: <RememberBody open={open} />,
    footer: <RememberFooter open={open} />,
    dirty: () =>
      open.saved.value === undefined &&
      (open.value.value !== (start.value ?? '') || open.typedKey.value !== undefined),
  })
}

function RememberBody({ open }: { readonly open: OpenRemember }) {
  const read = useLoad(readMemoryLimits).value

  if (read.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (read.status === 'failed') {
    return <p class="failure-line">{toFailureText(read.failure)}</p>
  }

  const saved = open.saved.value

  return saved === undefined ? (
    <RememberForm open={open} limits={read.value} />
  ) : (
    <p role="status">{tr('slash.memoryRememberStored', { key: saved })}</p>
  )
}

function RememberForm({
  open,
  limits,
}: {
  readonly open: OpenRemember
  readonly limits: MemoryLimits
}) {
  const fields = open.failure.value?.fields

  useEffect(() => {
    open.keyMaxLen.value = limits.keyMaxLen
  }, [limits.keyMaxLen])

  return (
    <div class="dialog-form">
      <FieldNote message={open.failure.value?.top} />
      <label class="form-field form-label">
        {tr('ui.office.memory.value')}
        <textarea
          rows={VALUE_ROWS}
          value={open.value.value}
          onInput={(event) => {
            open.value.value = event.currentTarget.value
          }}
        />
        <FieldNote message={fields?.get('value')} />
      </label>
      <label class="form-field form-label">
        {tr('ui.office.memory.key')}
        <input
          type="text"
          class="mono"
          maxLength={limits.keyMaxLen}
          value={resolveKey(open) ?? ''}
          onInput={(event) => {
            open.typedKey.value = event.currentTarget.value
          }}
        />
        <FieldNote message={fields?.get('key')} />
      </label>
      <p class="meta">{tr('ui.office.memory.keyNote')}</p>
      <p class="meta">{tr('ui.office.memory.expires', { days: limits.ttlDays })}</p>
      <p class="meta">{tr('ui.office.memory.readByAi')}</p>
    </div>
  )
}

function RememberFooter({ open }: { readonly open: OpenRemember }) {
  const { onBack } = open.start
  const isSaved = open.saved.value !== undefined

  return (
    <>
      {onBack !== undefined && (
        <div class="dialog-foot-left">
          <Button onClick={onBack}>{tr('ui.office.settings.toSettings')}</Button>
        </div>
      )}
      <Button onClick={() => open.handle?.close()}>
        {tr(isSaved ? 'ui.office.common.close' : 'ui.office.common.cancel')}
      </Button>
      {!isSaved && (
        <Button
          kind="commit"
          disabled={
            open.isBusy.value ||
            open.keyMaxLen.value === undefined ||
            open.value.value.trim() === ''
          }
          onClick={() => submit(open)}
        >
          {tr('ui.office.memory.addTitle')}
        </Button>
      )}
    </>
  )
}

// The suggested key follows the content until the operator types one of their own.
function resolveKey(open: OpenRemember): string | undefined {
  const maxLen = open.keyMaxLen.value

  if (open.typedKey.value !== undefined) {
    return open.typedKey.value
  }

  return maxLen === undefined ? undefined : toMemoryKey(open.value.value, maxLen)
}

// A refused key or value shows the daemon's sentence on its field; nothing is sent twice.
function submit(open: OpenRemember): void {
  const key = resolveKey(open)
  const value = open.value.value.trim()

  if (open.isBusy.value || key === undefined || value === '') {
    return
  }

  open.isBusy.value = true
  open.failure.value = undefined
  rememberNote(key, value)
    .then(
      () => {
        open.saved.value = key
      },
      (error: unknown) => {
        open.failure.value = describeFailure(error, FIELDS)
      }
    )
    .finally(() => {
      open.isBusy.value = false
    })
}
