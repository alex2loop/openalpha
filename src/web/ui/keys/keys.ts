import { effect } from '@preact/signals'

import type { MessageKey } from '@/i18n'
import type { PanelTab, PanelView } from '@/web/state/panel'
import { stopFollow, view } from '@/web/scene/view'
import { agents } from '@/web/state/agents'
import { isChatOpen, setChatOpen } from '@/web/state/chat'
import { focusInput } from '@/web/state/command'
import { openView, panelView, toggleFocus } from '@/web/state/panel'
import {
  COMMAND_KEY_CAP,
  CONTROL_KEY_CAP,
  DOWN_KEY_CAP,
  ENTER_KEY_CAP,
  ESCAPE_KEY_CAP,
  TAB_KEY_CAP,
  UP_KEY_CAP,
} from '@/web/text/glyphs'
import {
  DECISION_KEYS,
  type KeyedDecision,
  pressDecision,
  stepChosenRequest,
} from '@/web/ui/bell/bell-keys'
import { ESCAPE_KEY } from '@/web/ui/kit/focus-trap'
import {
  BELL_POPOVER_ID,
  JOBS_POPOVER_ID,
  openPopoverId,
  togglePopover,
} from '@/web/ui/kit/popover'
import { stepWrapped } from '@/web/ui/kit/step'

/** What the keys open that lives outside this module. */
interface KeyDeps {
  readonly openList: () => void
}

/** One line of the shortcut list: the key caps and what they do. */
interface ShortcutRow {
  readonly caps: readonly string[]
  readonly does: MessageKey
}

/** The key that opens the list, printed on the header's button. */
export const LIST_KEY = '?'

const INPUT_KEY = '/'
const PALETTE_KEY = 'k'
const BACK_KEY = '4'
const BELL_KEY = 'b'
const JOBS_KEY = 'j'
const CHAT_KEY = 'c'
const FOCUS_KEY = 'f'
const TAB_KEYS: Readonly<Record<string, PanelTab>> = Object.freeze({
  1: 'today',
  2: 'book',
  3: 'ideas',
})
const AGENT_STEPS: Readonly<Record<string, 1 | -1>> = Object.freeze({ '[': -1, ']': 1 })
const CHOOSE_STEPS: Readonly<Record<string, 1 | -1>> = Object.freeze({
  ArrowUp: -1,
  ArrowDown: 1,
})
const DECISION_BY_KEY: Readonly<Record<string, KeyedDecision>> = Object.freeze({
  [DECISION_KEYS.approve.toLowerCase()]: 'approve',
  [DECISION_KEYS.deny.toLowerCase()]: 'deny',
})
// Keys the office canvas answers itself while it has focus.
const CANVAS_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'Enter',
  ' ',
  ESCAPE_KEY,
])

/** Every shortcut, as the list shows it. */
export const SHORTCUT_ROWS: readonly ShortcutRow[] = Object.freeze([
  { caps: [LIST_KEY], does: 'ui.office.keys.list' },
  {
    caps: [
      INPUT_KEY,
      ...[CONTROL_KEY_CAP, COMMAND_KEY_CAP].map((cap) => toChord(cap, PALETTE_KEY)),
    ],
    does: 'ui.office.keys.focusInput',
  },
  { caps: Object.keys(TAB_KEYS), does: 'ui.office.keys.tabs' },
  { caps: [BACK_KEY], does: 'ui.office.keys.back' },
  { caps: [toCap(BELL_KEY)], does: 'ui.office.keys.bell' },
  { caps: [toCap(JOBS_KEY)], does: 'ui.office.keys.jobs' },
  { caps: [toCap(CHAT_KEY)], does: 'ui.office.keys.chat' },
  { caps: [toCap(FOCUS_KEY)], does: 'ui.office.keys.focus' },
  { caps: Object.keys(AGENT_STEPS), does: 'ui.office.keys.agents' },
  { caps: [TAB_KEY_CAP, ENTER_KEY_CAP], does: 'ui.office.keys.canvas' },
  { caps: [UP_KEY_CAP, DOWN_KEY_CAP], does: 'ui.office.keys.choose' },
  { caps: [DECISION_KEYS.approve, DECISION_KEYS.deny], does: 'ui.office.keys.approve' },
  { caps: [ESCAPE_KEY_CAP], does: 'ui.office.keys.close' },
])
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const OPEN_DIALOG_SELECTOR = '[aria-modal="true"]'

/** The page's shortcuts, on one `keydown` listener; the returned function removes it and stops
 *  remembering what was viewed. */
export function createKeyHandler(deps: KeyDeps): () => void {
  const listeners = new AbortController()
  const viewed: { last: PanelView | undefined } = { last: undefined }
  const stopViewed = effect(() => {
    const shown = panelView.value

    if (!('tab' in shown)) {
      viewed.last = shown
    }
  })

  document.addEventListener(
    'keydown',
    (event) => {
      if (handleKey(event, { deps, viewed: viewed.last })) {
        event.preventDefault()
      }
    },
    { signal: listeners.signal }
  )

  return () => {
    listeners.abort()
    stopViewed()
  }
}

interface KeyContext {
  readonly deps: KeyDeps
  readonly viewed: PanelView | undefined
}

// True when the key did something here.
function handleKey(event: KeyboardEvent, context: KeyContext): boolean {
  if (event.defaultPrevented || event.repeat || isOwnedElsewhere(event)) {
    return false
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === PALETTE_KEY
  ) {
    focusInput()
    return true
  }

  if (event.metaKey || event.ctrlKey || event.altKey || isInField(event.target)) {
    return false
  }

  return openPopoverId.value === BELL_POPOVER_ID && handleBellKey(event.key)
    ? true
    : handlePlainKey(event.key, context)
}

// A dialog takes its own keys, and the canvas its own while it has focus.
function isOwnedElsewhere(event: KeyboardEvent): boolean {
  const isOnCanvas = event.target instanceof HTMLCanvasElement && CANVAS_KEYS.has(event.key)

  return isOnCanvas || document.querySelector(OPEN_DIALOG_SELECTOR) !== null
}

function isInField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(FIELD_SELECTOR) !== null
}

// The open bell's own keys: Up and Down choose a request, Y and N answer the chosen one.
function handleBellKey(key: string): boolean {
  const step = CHOOSE_STEPS[key]
  const decision = DECISION_BY_KEY[key.toLowerCase()]

  if (step !== undefined) {
    return stepChosenRequest(step)
  }

  if (decision !== undefined) {
    pressDecision(decision)
    return true
  }

  return false
}

function handlePlainKey(key: string, context: KeyContext): boolean {
  const tab = TAB_KEYS[key]
  const agentStep = AGENT_STEPS[key]

  if (tab !== undefined) {
    openView({ tab }, { fresh: true })
    return true
  }

  if (agentStep !== undefined) {
    return stepAgent(agentStep)
  }

  return handleNamedKey(key, context)
}

function handleNamedKey(key: string, { deps, viewed }: KeyContext): boolean {
  switch (key.toLowerCase()) {
    case INPUT_KEY:
      focusInput()
      return true
    case LIST_KEY:
      deps.openList()
      return true
    case BACK_KEY:
      return reopen(viewed)
    case BELL_KEY:
      togglePopover(BELL_POPOVER_ID)
      return true
    case JOBS_KEY:
      togglePopover(JOBS_POPOVER_ID)
      return true
    case CHAT_KEY:
      setChatOpen(!isChatOpen.value)
      return true
    case FOCUS_KEY:
      toggleFocus()
      return true
    case ESCAPE_KEY.toLowerCase():
      return endFollow()
    default:
      return false
  }
}

function reopen(viewed: PanelView | undefined): boolean {
  if (viewed === undefined) {
    return false
  }

  openView(viewed)

  return true
}

// From the agent open now, or from either end when none is.
function stepAgent(step: 1 | -1): boolean {
  const ids = agents.value.map((agent) => agent.id)
  const shown = panelView.value
  const at = 'agent' in shown ? ids.indexOf(shown.agent) : -1
  const next = ids[stepWrapped(at, step, ids.length)]

  if (next === undefined) {
    return false
  }

  openView({ agent: next })

  return true
}

// Esc with nothing else open lets go of the person the camera follows. An open popover closes on
// its own listener.
function endFollow(): boolean {
  if (openPopoverId.value !== undefined || view.value.follow === undefined) {
    return false
  }

  stopFollow()

  return true
}

function toCap(key: string): string {
  return key.toUpperCase()
}

function toChord(modifier: string, key: string): string {
  return `${modifier} ${toCap(key)}`
}
