import { useEffect, useRef, useState } from 'preact/hooks'

import { ESCAPE_KEY } from '@/web/ui/kit/focus-trap'
import { IDENTIFIER_INPUT } from '@/web/ui/kit/identifier-input'

import './combobox.css'

interface ComboboxProps {
  readonly id: string
  readonly label: string
  readonly value: string
  /** What the list offers; the field still takes any text. */
  readonly options: readonly string[]
  readonly onInput: (value: string) => void
}

interface Suggestions {
  readonly shown: readonly string[]
  readonly isListed: boolean
  readonly isOpen: boolean
  readonly active: number | undefined
  /** The entry the arrow keys rest on. */
  readonly chosen: string | undefined
  readonly open: (isNarrowed: boolean) => void
  readonly close: () => void
  readonly move: (to: number) => void
}

type KeyAction =
  | { readonly kind: 'open' | 'close' }
  | { readonly kind: 'pick'; readonly option: string }
  | { readonly kind: 'move'; readonly to: number }

/** A text field with a list of suggestions the page draws itself, so no browser adds a marker.
 *  The list opens on focus and narrows as the operator types; Esc, Tab or a press elsewhere closes
 *  it. It holds no listener of its own: leaving the field is what closes it. */
export function Combobox({ id, label, value, options, onInput }: ComboboxProps) {
  const list = useSuggestions(value, options)
  const listId = `${id}-list`

  function pick(option: string): void {
    onInput(option)
    list.close()
  }

  return (
    <div class="combobox">
      <input
        type="text"
        {...IDENTIFIER_INPUT}
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={list.isListed}
        aria-controls={list.isListed ? listId : undefined}
        aria-activedescendant={list.chosen === undefined ? undefined : `${listId}-${list.active}`}
        aria-label={label}
        title={value}
        value={value}
        onFocus={() => list.open(false)}
        onClick={() => !list.isOpen && list.open(false)}
        onBlur={list.close}
        onInput={(event) => {
          onInput(event.currentTarget.value)
          list.open(true)
        }}
        onKeyDown={(event) => handleKey(event, { list, pick })}
      />
      {list.isListed && <OptionList id={listId} label={label} list={list} onPick={pick} />}
    </div>
  )
}

function useSuggestions(value: string, options: readonly string[]): Suggestions {
  const [isOpen, setOpen] = useState(false)
  const [isNarrowed, setNarrowed] = useState(false)
  const [active, setActive] = useState<number | undefined>(undefined)
  const typed = value.trim().toLowerCase()
  const shown = isNarrowed
    ? options.filter((option) => option.toLowerCase().includes(typed))
    : options

  const at = active !== undefined && active < shown.length ? active : undefined

  return {
    shown,
    isOpen,
    isListed: isOpen && shown.length > 0,
    active: at,
    chosen: at === undefined ? undefined : shown[at],
    open: (narrowed) => {
      setOpen(true)
      setNarrowed(narrowed)
      setActive(undefined)
    },
    close: () => {
      setOpen(false)
      setActive(undefined)
    },
    move: setActive,
  }
}

function readKey(
  key: string,
  { shown, isListed, active, chosen }: Suggestions
): KeyAction | undefined {
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const step = key === 'ArrowDown' ? 1 : -1
    const from = active ?? (step > 0 ? -1 : 0)

    return isListed
      ? { kind: 'move', to: (from + step + shown.length) % shown.length }
      : { kind: 'open' }
  }

  if (key === 'Enter' && chosen !== undefined) {
    return { kind: 'pick', option: chosen }
  }

  return key === ESCAPE_KEY && isListed ? { kind: 'close' } : undefined
}

interface KeyContext {
  readonly list: Suggestions
  readonly pick: (option: string) => void
}

function handleKey(event: KeyboardEvent, { list, pick }: KeyContext): void {
  const action = readKey(event.key, list)

  if (action === undefined) {
    return
  }

  event.preventDefault()

  if (action.kind === 'open') {
    list.open(false)
  } else if (action.kind === 'move') {
    list.move(action.to)
  } else if (action.kind === 'pick') {
    pick(action.option)
  } else {
    // The open list takes Esc for itself; the dialog around it stays.
    event.stopPropagation()
    list.close()
  }
}

interface OptionListProps {
  readonly id: string
  readonly label: string
  readonly list: Suggestions
  readonly onPick: (option: string) => void
}

// A press must not take focus from the field: it would close the list before the pick lands.
function OptionList({ id, label, list, onPick }: OptionListProps) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (list.active !== undefined) {
      box.current?.children[list.active]?.scrollIntoView({ block: 'nearest' })
    }
  }, [list.active])

  return (
    <div
      ref={box}
      id={id}
      class="combobox-list chrome-glass is-menu"
      role="listbox"
      aria-label={label}
      onPointerDown={(event) => event.preventDefault()}
    >
      {list.shown.map((option, index) => (
        <div
          key={option}
          id={`${id}-${index}`}
          role="option"
          tabIndex={-1}
          aria-selected={index === list.active}
          class={index === list.active ? 'combobox-option is-active' : 'combobox-option'}
          title={option}
          onPointerDown={() => onPick(option)}
        >
          {option}
        </div>
      ))}
    </div>
  )
}
