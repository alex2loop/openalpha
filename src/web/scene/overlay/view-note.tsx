import { signal } from '@preact/signals'

import { tr } from '@/web/text/tr'

import './view-note.css'

type ViewNoteKind = 'loading' | 'fallback'

const NOTE_KEYS = Object.freeze({
  loading: 'ui.office.scene.loading',
  fallback: 'ui.office.scene.fallback',
} as const satisfies Record<ViewNoteKind, string>)

const note = signal<ViewNoteKind | undefined>(undefined)

/** Shows the line about the 3D view, or clears it. */
export function showViewNote(kind: ViewNoteKind | undefined): void {
  note.value = kind
}

/** The 3D view's loading line, or why the office stayed in 2D. */
export function ViewNote() {
  const kind = note.value

  return kind === undefined ? null : (
    <p class="view-note glass" role="status">
      {tr(NOTE_KEYS[kind])}
    </p>
  )
}
