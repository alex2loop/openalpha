import type { RefObject, TargetedKeyboardEvent } from 'preact'
import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { isChatOpen, setChatOpen, unread } from '@/web/state/chat'
import {
  inputText,
  isNotSent,
  isRecalling,
  recall,
  registerInput,
  sendFromInput,
  setInput,
} from '@/web/state/command'
import { tr } from '@/web/text/tr'
import {
  resolveSendLabel,
  type SuggestOption,
  SuggestPopover,
  useSuggestions,
} from '@/web/ui/command/suggest-popover'
import { WhoChip } from '@/web/ui/command/who-chip'
import { Button } from '@/web/ui/kit/button'
import { ChatIcon } from '@/web/ui/kit/icons'

import './command.css'

const LIST_ID = 'command-suggestions'
const COMMAND_PREFIX = '/'

/** The popover's state: which row the arrows chose, whether Tab listed every command, and whether
 *  Esc closed it until the next keystroke. */
interface ListState {
  readonly activeIndex: Signal<number | undefined>
  readonly isAllCommands: Signal<boolean>
  readonly isOpen: Signal<boolean>
}

/** The box at the bottom: who receives it, what is typed, what it would do, and the chat toggle. */
export function CommandBar() {
  const input = useRef<HTMLInputElement>(null)
  const list: ListState = {
    activeIndex: useSignal(undefined),
    isAllCommands: useSignal(false),
    isOpen: useSignal(false),
  }
  const options = useSuggestions(inputText.value, list.isAllCommands.value)

  useEffect(() => (input.current === null ? undefined : registerInput(input.current)), [])

  return (
    <footer class="command-bar glass">
      <WhoChip />
      <div class="command-box">
        {list.isOpen.value && options.length > 0 && (
          <SuggestPopover
            id={LIST_ID}
            options={options}
            activeIndex={list.activeIndex.value}
            onPick={(option) => pick(option, list)}
          />
        )}
        <CommandInput inputRef={input} list={list} options={options} />
        {isNotSent.value && (
          <p class="command-not-sent" role="alert">
            {tr('ui.office.command.notSent')}
          </p>
        )}
      </div>
      <Button kind="commit" disabled={inputText.value.trim() === ''} onClick={sendFromInput}>
        {inputText.value.trim().startsWith(COMMAND_PREFIX)
          ? tr('ui.office.command.run')
          : resolveSendLabel()}
      </Button>
      <ChatToggle />
    </footer>
  )
}

interface CommandInputProps {
  readonly inputRef: RefObject<HTMLInputElement>
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

function ChatToggle() {
  return (
    <button
      type="button"
      class="icon-button command-chat"
      title={tr('ui.office.chat.toggle')}
      aria-label={tr('ui.office.chat.toggle')}
      aria-pressed={isChatOpen.value}
      onClick={() => setChatOpen(!isChatOpen.value)}
    >
      <ChatIcon />
      {unread.value && <span class="chat-unread" aria-hidden="true" />}
    </button>
  )
}

function resetList(list: ListState, isOpen: boolean): void {
  list.activeIndex.value = undefined
  list.isAllCommands.value = false
  list.isOpen.value = isOpen
}

// A fill row puts its text in the box; the send row sends what is typed.
function pick(option: SuggestOption, list: ListState): void {
  if (option.fill === undefined) {
    sendFromInput()
    resetList(list, true)
    return
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
        sendFromInput()
      }
      return true
    case 'Escape':
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
    chosen ?? options.find((option) => option.section === 'commands' || option.section === 'ticker')

  if (target?.fill === undefined) {
    return false
  }

  pick(target, list)

  return true
}
