import type { ComponentChildren } from 'preact'
import { type Signal, useSignal } from '@preact/signals'

import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

/** A value being edited and the one last saved, so a row knows it has something to save. */
interface Draft<T> {
  readonly draft: Signal<T>
  readonly isChanged: boolean
  /** The draft is now what is saved. */
  markSaved(): void
}

/** What every section of the settings dialog takes: how to come back to the dialog after a form
 *  it opened has closed. */
export interface SectionProps {
  readonly reopen: () => void
}

type RowStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly text: string }

interface SettingRowProps {
  readonly title: string
  readonly note?: string
  /** `restart`: saved to the file, applied when the daemon next starts. */
  readonly timing: 'now' | 'restart'
  readonly isChanged: boolean
  /** False keeps "Lưu" off though something changed (a text not yet checked). */
  readonly isReady?: boolean
  /** What the daemon holds now, as a line under the control. */
  readonly current?: string
  /** Throws `ApiFailure`; the row shows the daemon's sentence and keeps what was typed. */
  readonly onSave: () => Promise<void>
  readonly extra?: ComponentChildren
  readonly children: ComponentChildren
}

export function useDraft<T>(initial: T): Draft<T> {
  const draft = useSignal(initial)
  const saved = useSignal(initial)

  return {
    draft,
    isChanged: JSON.stringify(draft.value) !== JSON.stringify(saved.value),
    markSaved: () => {
      saved.value = draft.value
    },
  }
}

/** One setting: its controls, "Lưu", and whether the change holds at once or waits for a restart. */
export function SettingRow(props: SettingRowProps) {
  const { title, note, timing, isChanged, current, extra, children } = props
  const status = useSignal<RowStatus>({ kind: 'idle' })
  const isSaved = status.value.kind === 'saved' && !isChanged

  return (
    <section class="setting-row">
      <h3 class="setting-title">
        {title}
        {timing === 'restart' && (
          <span class="setting-tag">{tr('ui.office.settings.needsRestart')}</span>
        )}
      </h3>
      <div class="setting-controls">{children}</div>
      {note !== undefined && <p class="meta">{note}</p>}
      {current !== undefined && <p class="meta">{current}</p>}
      <div class="setting-actions">
        <Button
          size="small"
          kind="commit"
          disabled={!isChanged || props.isReady === false || status.value.kind === 'saving'}
          onClick={() => save(props, status)}
        >
          {tr('ui.office.common.save')}
        </Button>
        {extra}
        <StatusLine status={status.value} isSaved={isSaved} timing={timing} />
      </div>
    </section>
  )
}

function StatusLine({
  status,
  isSaved,
  timing,
}: {
  readonly status: RowStatus
  readonly isSaved: boolean
  readonly timing: SettingRowProps['timing']
}) {
  if (status.kind === 'failed') {
    return (
      <span class="failure-line" role="alert">
        {status.text}
      </span>
    )
  }

  if (isSaved) {
    return (
      <span class="meta">
        {tr(timing === 'now' ? 'ui.office.settings.savedNow' : 'ui.office.settings.savedLater')}
      </span>
    )
  }

  return (
    <span class="meta">
      {tr(timing === 'now' ? 'ui.office.settings.nowRow' : 'ui.office.settings.restartRow')}
    </span>
  )
}

function save(props: SettingRowProps, status: Signal<RowStatus>): void {
  status.value = { kind: 'saving' }
  props.onSave().then(
    () => {
      status.value = { kind: 'saved' }
    },
    (error: unknown) => {
      status.value = { kind: 'failed', text: toErrorText(error) }
    }
  )
}

interface ActionRowProps {
  readonly title: string
  readonly summary?: string
  readonly note?: string
  /** One or two buttons that open the thing the row is about. */
  readonly children: ComponentChildren
}

/** A setting with nothing to save here: what it holds now, and the buttons that open its form. */
export function ActionRow({ title, summary, note, children }: ActionRowProps) {
  return (
    <section class="setting-row">
      <h3 class="setting-title">{title}</h3>
      {summary !== undefined && summary !== '' && <p>{summary}</p>}
      {note !== undefined && <p class="meta">{note}</p>}
      <div class="setting-actions">{children}</div>
    </section>
  )
}
