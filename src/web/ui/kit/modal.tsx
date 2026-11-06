import type { ComponentChild, TargetedMouseEvent } from 'preact'
import { signal } from '@preact/signals'
import { useEffect, useLayoutEffect } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { ESCAPE_KEY, trapFocus } from '@/web/ui/kit/focus-trap'
import { CloseIcon } from '@/web/ui/kit/icons'
import { closePopover, openPopoverId, resolveFocusReturn } from '@/web/ui/kit/popover'

import './modal.css'

const DIALOG_ID = 'modal-dialog'
// The undo bar sits above the dialog, so Tab reaches its Undo too.
const FOCUS_RING = '.modal, .undo-bar'
const TITLE_ID = 'modal-title'
// The dialog's main action: Enter presses it, and it takes focus when the body has no field. A
// destructive button never is one.
const MAIN_BUTTON = '.modal-foot .btn-commit:not(:disabled), .modal-foot .btn-ai:not(:disabled)'
// A link or a button in the body is not a field: focusing it on open only draws a ring around it.
const BODY_FIELD = '.modal-body :is(input, select, textarea):not(:disabled)'
// Input types that are one line of text; Enter in any other control keeps its own meaning.
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  'password',
])

interface ModalSpec {
  readonly title: string
  readonly body: ComponentChild
  readonly footer: ComponentChild
  /** True while closing would lose what the operator typed: Esc or an outside click then asks once. */
  readonly dirty?: () => boolean
  /** Where Esc, an outside click and the close button go instead of closing: back to Cài đặt or
   *  the dialog this one was opened from. */
  readonly onDismiss?: () => void
  readonly wide?: true
}

export interface ModalHandle {
  /** Closes this dialog if it is still the one open. */
  close(): void
  /** Whether this dialog is still the one open. */
  isOpen(): boolean
}

interface OpenModal {
  readonly spec: ModalSpec
  readonly opener: HTMLElement | undefined
  readonly listeners: AbortController
  readonly seq: number
}

const current = signal<OpenModal | undefined>(undefined)
const isUnsavedNoted = signal(false)
let modalSeq = 0

/** Opens the page's one dialog, replacing any open one and closing any popover. Focus moves into
 *  it, stays there, and returns to the element that had it when it closes. */
export function openModal(spec: ModalSpec): ModalHandle {
  // A dialog that replaces another keeps the first one's return target.
  const opener = current.value?.opener ?? resolveFocusReturn(document.activeElement)

  releaseModal()
  closePopover()
  modalSeq++

  const entry: OpenModal = { spec, opener, listeners: new AbortController(), seq: modalSeq }

  current.value = entry
  document.addEventListener('keydown', (event) => onKey(entry, event), {
    signal: entry.listeners.signal,
  })

  return {
    close: () => {
      if (current.value === entry) {
        closeModal()
      }
    },
    isOpen: () => current.value === entry,
  }
}

/** Closes the open dialog at once and returns focus; idempotent. */
export function closeModal(): void {
  const entry = releaseModal()

  if (entry?.opener?.isConnected === true) {
    entry.opener.focus()
  }
}

// Undoes the open dialog without moving focus, for a close or a replacement.
function releaseModal(): OpenModal | undefined {
  const entry = current.value

  if (entry === undefined) {
    return undefined
  }

  entry.listeners.abort()
  current.value = undefined
  isUnsavedNoted.value = false

  return entry
}

/** Mounted once by the shell; a dialog open when the shell leaves (a sign-out) closes with it. */
export function ModalHost() {
  const entry = current.value

  useLayoutEffect(() => closeModal, [])

  return entry === undefined ? null : <ModalView key={entry.seq} entry={entry} />
}

function ModalView({ entry }: { readonly entry: OpenModal }) {
  const { title, body, footer, wide } = entry.spec

  useEffect(focusFirst, [])

  return (
    <div class="modal scrim" onPointerDown={(event) => dismissOnScrim(entry, event)}>
      <div
        id={DIALOG_ID}
        class={wide === true ? 'modal-dialog solid-pop is-wide' : 'modal-dialog solid-pop'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
      >
        <div class="modal-head">
          <h2 id={TITLE_ID}>{title}</h2>
          <button
            type="button"
            class="btn btn-ghost btn-small"
            title={tr('ui.office.common.close')}
            aria-label={tr('ui.office.common.close')}
            onClick={() => leaveModal(entry)}
          >
            <CloseIcon />
          </button>
        </div>
        <div class="modal-body">{body}</div>
        {isUnsavedNoted.value && (
          <p class="modal-unsaved" role="alert">
            {tr('ui.office.common.unsaved')}
          </p>
        )}
        <div class="modal-foot">{footer}</div>
      </div>
    </div>
  )
}

function dismissOnScrim(entry: OpenModal, event: TargetedMouseEvent<HTMLDivElement>): void {
  if (event.target === event.currentTarget) {
    dismiss(entry)
  }
}

function onKey(entry: OpenModal, event: KeyboardEvent): void {
  // A popover open over the dialog (a row's menu) takes Esc for itself.
  if (event.key === ESCAPE_KEY && openPopoverId.value !== undefined) {
    return
  }

  if (event.key === ESCAPE_KEY) {
    event.preventDefault()
    dismiss(entry)
    return
  }

  if (event.key === 'Tab') {
    trapFocus(event, FOCUS_RING)
    return
  }

  if (event.key === 'Enter') {
    pressMain(event)
  }
}

// Esc and an outside click: a dirty dialog asks once, the second one closes.
function dismiss(entry: OpenModal): void {
  if (entry.spec.dirty?.() === true && !isUnsavedNoted.value) {
    isUnsavedNoted.value = true
    return
  }

  leaveModal(entry)
}

// The way out of a dialog: its own return when it has one, else a plain close.
function leaveModal(entry: OpenModal): void {
  if (entry.spec.onDismiss === undefined) {
    closeModal()
    return
  }

  entry.spec.onDismiss()
}

function pressMain(event: KeyboardEvent): void {
  const target = event.target

  if (!(target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type))) {
    return
  }

  const main = document.querySelector(MAIN_BUTTON)

  if (main instanceof HTMLButtonElement) {
    event.preventDefault()
    main.click()
  }
}

// A field in the body takes focus first, else the main (safe) footer button, else the dialog.
function focusFirst(): void {
  const target = firstElementOf([BODY_FIELD, MAIN_BUTTON]) ?? document.getElementById(DIALOG_ID)

  target?.focus()
}

// The first selector, in the order given, that matches an element.
function firstElementOf(selectors: readonly string[]): HTMLElement | undefined {
  for (const selector of selectors) {
    const element = document.querySelector(selector)

    if (element instanceof HTMLElement) {
      return element
    }
  }

  return undefined
}
