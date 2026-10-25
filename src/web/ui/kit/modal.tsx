import type { ComponentChild, TargetedMouseEvent } from 'preact'
import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { CloseIcon } from '@/web/ui/kit/icons'
import { closePopover, resolveFocusReturn } from '@/web/ui/kit/popover'

import './modal.css'

const DIALOG_ID = 'modal-dialog'
const TITLE_ID = 'modal-title'
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
// The dialog's main action: Enter presses it, and it takes focus when the body has no field. A
// destructive button never is one.
const MAIN_BUTTON = '.modal-foot .btn-commit:not(:disabled), .modal-foot .btn-ai:not(:disabled)'
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
  readonly wide?: true
}

export interface ModalHandle {
  /** Closes this dialog if it is still the one open. */
  close(): void
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

  useEffect(() => closeModal, [])

  return entry === undefined ? null : <ModalView key={entry.seq} entry={entry} />
}

function ModalView({ entry }: { readonly entry: OpenModal }) {
  const { title, body, footer, wide } = entry.spec

  useEffect(focusFirst, [])

  return (
    <div class="modal" onPointerDown={(event) => dismissOnScrim(entry, event)}>
      <div
        id={DIALOG_ID}
        class={wide === true ? 'modal-dialog is-wide' : 'modal-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
      >
        <div class="modal-head">
          <h2 id={TITLE_ID}>{title}</h2>
          <button
            type="button"
            class="icon-button"
            aria-label={tr('ui.office.common.close')}
            onClick={closeModal}
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
  if (event.key === 'Escape') {
    event.preventDefault()
    dismiss(entry)
    return
  }

  if (event.key === 'Tab') {
    trapFocus(event)
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

  closeModal()
}

// Focus cycles inside the dialog; from the dialog itself it enters at the near end.
function trapFocus(event: KeyboardEvent): void {
  const focusable = listFocusable(`#${DIALOG_ID}`)
  const first = focusable[0]
  const last = focusable.at(-1)
  const active = document.activeElement

  if (first === undefined || last === undefined) {
    event.preventDefault()
    return
  }

  const isInside = focusable.some((element) => element === active)
  const edge = event.shiftKey ? first : last

  if (isInside && active !== edge) {
    return
  }

  event.preventDefault()

  if (event.shiftKey) {
    last.focus()
  } else {
    first.focus()
  }
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
  const [field] = listFocusable('.modal-body')
  const main = document.querySelector(MAIN_BUTTON)
  const target = field ?? (main instanceof HTMLElement ? main : document.getElementById(DIALOG_ID))

  target?.focus()
}

function listFocusable(within: string): HTMLElement[] {
  const container = document.querySelector(within)

  return container === null
    ? []
    : [...container.querySelectorAll(FOCUSABLE)].filter(
        (element): element is HTMLElement => element instanceof HTMLElement
      )
}
