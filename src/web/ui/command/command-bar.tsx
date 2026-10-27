import type { RefObject, TargetedKeyboardEvent } from 'preact'
import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { selectAgent } from '@/web/state/agents'
import { breakpoint } from '@/web/state/breakpoints'
import { APP_CHANNEL, isChatOpen, setChatOpen, unread, viewedSession } from '@/web/state/chat'
import {
  inputText,
  isNotSent,
  isRecalling,
  recall,
  registerInput,
  sendFromInput,
  setInput,
} from '@/web/state/command'
import { isChatOnly } from '@/web/state/pane'
import { tr } from '@/web/text/tr'
import { ReadOnlyLine } from '@/web/ui/chat/session-view'
import {
  resolveSendLabel,
  type SuggestOption,
  SuggestPopover,
  useSuggestions,
} from '@/web/ui/command/suggest-popover'
import { WhoChip } from '@/web/ui/command/who-chip'
import { Button } from '@/web/ui/kit/button'
import { ESCAPE_KEY } from '@/web/ui/kit/focus-trap'
import { ChatIcon, SendIcon, SlashIcon } from '@/web/ui/kit/icons'

import './command.css'

const LIST_ID = 'command-suggestions'
const COMMAND_PREFIX = '/'
// A floating bar's islands: glass, the field denser since it carries the text.
const ISLAND = 'command-island glass'
const FIELD_ISLAND = `${ISLAND} is-strong`

/** The popover's state: which row the arrows chose, whether Tab listed every command, and whether
 *  Esc closed it until the next keystroke. */
interface ListState {
  readonly activeIndex: Signal<number | undefined>
  readonly isAllCommands: Signal<boolean>
  readonly isOpen: Signal<boolean>
}

/** The box at the bottom: who receives it, what is typed, what it would do, and the chat toggle. A
 *  chat tab keeps only the box: it reads no agent roster, and its chat never closes. While another
 *  channel's session is open in the chat, a line says it is read-only here instead. Floating over
 *  the stage, each piece is a glass island, and the side ones shrink to their icon while typing. */
export function CommandBar({ isFloating = false }: { readonly isFloating?: boolean }) {
  const viewed = viewedSession.value
  const readOnly =
    isChatOpen.value && viewed !== undefined && viewed.channel !== APP_CHANNEL ? viewed : undefined

  return (
    <footer class={isFloating ? 'command-bar is-floating' : 'command-bar chrome-glass'}>
      {readOnly === undefined && <Composer isFloating={isFloating} />}
      {readOnly !== undefined &&
        (isFloating ? (
          <div class={`${FIELD_ISLAND} command-readonly`}>
            <ReadOnlyLine session={readOnly} />
          </div>
        ) : (
          <ReadOnlyLine session={readOnly} />
        ))}
      {!isChatOnly.value && <ChatToggle isFloating={isFloating} />}
    </footer>
  )
}

function Composer({ isFloating }: { readonly isFloating: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const list: ListState = {
    activeIndex: useSignal(undefined),
    isAllCommands: useSignal(false),
    isOpen: useSignal(false),
  }
  const { options, usage } = useSuggestions(inputText.value, list.isAllCommands.value)

  useEffect(() => (input.current === null ? undefined : registerInput(input.current)), [])

  return (
    <>
      {!isChatOnly.value && <WhoChip island={isFloating ? ISLAND : undefined} />}
      <div class="command-box">
        {list.isOpen.value && options.length > 0 && (
          <SuggestPopover
            id={LIST_ID}
            options={options}
            usage={usage}
            activeIndex={list.activeIndex.value}
            onPick={(option) => pick(option, list)}
          />
        )}
        <div class={isFloating ? `command-field ${FIELD_ISLAND}` : 'command-field'}>
          <SlashIcon class="command-mark" />
          <CommandInput inputRef={input} list={list} options={options} />
          <kbd class="command-key">{COMMAND_PREFIX}</kbd>
        </div>
        {isNotSent.value && (
          <p
            class={isFloating ? 'command-not-sent glass is-strong' : 'command-not-sent'}
            role="alert"
          >
            {tr('ui.office.command.notSent')}
          </p>
        )}
      </div>
      {breakpoint.value === 'phone' && <SendButton list={list} isFloating={isFloating} />}
    </>
  )
}

interface SendButtonProps {
  readonly list: ListState
  readonly isFloating: boolean
}

// A phone has no Enter key on every keyboard, so it keeps a button for the same send; floating, it
// is an icon island named by its label.
function SendButton({ list, isFloating }: SendButtonProps) {
  const typed = inputText.value.trim()
  const label = typed.startsWith(COMMAND_PREFIX) ? tr('ui.office.command.run') : resolveSendLabel()

  if (isFloating) {
    return (
      <button
        type="button"
        class={`${ISLAND} command-send`}
        aria-label={label}
        title={label}
        disabled={typed === ''}
        onClick={() => send(list)}
      >
        <SendIcon />
      </button>
    )
  }

  return (
    <Button kind="commit" disabled={typed === ''} onClick={() => send(list)}>
      {label}
    </Button>
  )
}

interface CommandInputProps {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly list: ListState
  readonly options: readonly SuggestOption[]
}

function CommandInput({ inputRef, list, options }: CommandInputProps) {
  return (
    <input
      ref={inputRef}
      class="command-input"
      type="text"
      autocomplete="off"
      role="combobox"
      aria-expanded={list.isOpen.value}
      aria-controls={LIST_ID}
      aria-label={tr('ui.office.command.placeholder')}
      placeholder={tr('ui.office.command.placeholder')}
      value={inputText.value}
      onFocus={() => (list.isOpen.value = true)}
      onBlur={() => resetList(list, false)}
      onInput={(event) => {
        setInput(event.currentTarget.value)
        resetList(list, true)
      }}
      onKeyDown={(event) => onKey(event, { list, options })}
    />
  )
}

function ChatToggle({ isFloating }: { readonly isFloating: boolean }) {
  return (
    <button
      type="button"
      class={isFloating ? `${ISLAND} command-chat` : 'btn btn-secondary btn-regular command-chat'}
      title={tr('ui.office.chat.toggle')}
      aria-pressed={isChatOpen.value}
      onClick={() => setChatOpen(!isChatOpen.value)}
    >
      <ChatIcon />
      <span class="command-island-text">{tr('ui.office.chat.title')}</span>
      {unread.value && <span class="chat-unread" aria-hidden="true" />}
    </button>
  )
}

function resetList(list: ListState, isOpen: boolean): void {
  list.activeIndex.value = undefined
  list.isAllCommands.value = false
  list.isOpen.value = isOpen
}

// Sending hands the turn to the chat it opens, so the list over the box goes with it.
function send(list: ListState): void {
  sendFromInput()
  resetList(list, false)
}

// A fill row puts its text in the box; the send row sends what is typed.
function pick(option: SuggestOption, list: ListState): void {
  if (option.fill === undefined) {
    send(list)
    return
  }

  if (option.agentId !== undefined) {
    selectAgent(option.agentId)
  }

  setInput(option.fill)
  resetList(list, true)
}

interface KeyContext {
  readonly list: ListState
  readonly options: readonly SuggestOption[]
}

function onKey(event: TargetedKeyboardEvent<HTMLInputElement>, context: KeyContext): void {
  const handled = handleKey(event.key, context)

  if (handled) {
    event.preventDefault()
  }
}

// Returns true when the key did something here; Tab with nothing to complete moves focus.
function handleKey(key: string, { list, options }: KeyContext): boolean {
  const chosen = list.activeIndex.value === undefined ? undefined : options[list.activeIndex.value]

  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown':
      moveOrRecall(key === 'ArrowUp' ? -1 : 1, { list, options })
      return true
    case 'Tab':
      return complete(chosen, { list, options })
    case 'Enter':
      if (chosen !== undefined) {
        pick(chosen, list)
      } else {
        send(list)
      }
      return true
    case ESCAPE_KEY:
      resetList(list, false)
      return true
    default:
      return false
  }
}

// On an empty box, or one holding a recalled line, the arrows walk what was sent.
function moveOrRecall(step: -1 | 1, { list, options }: KeyContext): void {
  if (list.activeIndex.value === undefined && isRecalling()) {
    recall(step < 0 ? 'older' : 'newer')
    return
  }

  if (options.length === 0) {
    return
  }

  const current = list.activeIndex.value ?? (step > 0 ? -1 : 0)

  list.isOpen.value = true
  list.activeIndex.value = (current + step + options.length) % options.length
}

function complete(chosen: SuggestOption | undefined, { list, options }: KeyContext): boolean {
  if (inputText.value.trim() === '' && chosen === undefined) {
    list.isAllCommands.value = true
    list.isOpen.value = true
    return true
  }

  const target =
    chosen ??
    options.find((option) => option.section !== 'send' && option.section !== 'suggestions')

  if (target?.fill === undefined) {
    return false
  }

  pick(target, list)

  return true
}
