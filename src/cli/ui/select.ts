import type { Key } from 'node:readline'
import { emitKeypressEvents } from 'node:readline'

import { ask, hint, style } from '@/cli/ui/colors'
import { suspendKeypressListeners } from '@/cli/ui/prompt'

const CLEAR_DOWN = '\u001B[0J'
const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'
const MIN_COLUMNS = 1
const STEP_BY_KEY: Readonly<Record<string, number>> = { up: -1, down: 1 }

/** The mark on the chosen line, here and in the typed menu a pipe gets. */
export const MENU_MARKER = '>'

export interface SelectOption {
  readonly label: string
  readonly note?: string
}

interface SelectQuestion<O extends SelectOption> {
  readonly question: string
  /** The keys line printed beside the question. */
  readonly hint: string
  readonly options: readonly O[]
  readonly selected: number
}

type SelectKey =
  | { readonly kind: 'move'; readonly to: number }
  | { readonly kind: 'pick' }
  | { readonly kind: 'cancel' }

/** Up and Down move the mark, Enter picks, Escape, Ctrl-C or a closed terminal cancels with the
 *  abort a cancelled question raises. Leaves one answered line in place of the menu. Raw mode, the
 *  cursor and every keypress listener another prompt held are restored on every path. */
export async function selectOption<O extends SelectOption>(
  question: SelectQuestion<O>
): Promise<O> {
  const wasRaw = process.stdin.isRaw
  const restoreKeys = suspendKeypressListeners(process.stdin)
  let rows = 0

  try {
    emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdout.write(HIDE_CURSOR)
    rows = render(question, question.selected, rows)

    const picked = await readSelection(question, (to) => {
      rows = render(question, to, rows)
    })

    clearRows(rows)
    process.stdout.write(`${ask(question.question)} ${style.accent(picked.label)}\n`)

    return picked
  } finally {
    process.stdout.write(SHOW_CURSOR)
    process.stdin.setRawMode(wasRaw)
    restoreKeys()
  }
}

function readSelection<O extends SelectOption>(
  question: SelectQuestion<O>,
  move: (to: number) => void
): Promise<O> {
  let current = question.selected

  return new Promise((resolve, reject) => {
    const onKeypress = (_character: string | undefined, key: Key | undefined): void => {
      const action = toSelectKey({ key, size: question.options.length, current })

      if (action?.kind === 'move') {
        current = action.to
        move(current)
        return
      }

      if (action !== undefined) {
        settle(action.kind === 'pick' ? question.options[current] : undefined)
      }
    }
    const onEnd = (): void => settle(undefined)
    const settle = (picked: O | undefined): void => {
      process.stdin.off('keypress', onKeypress)
      process.stdin.off('end', onEnd)

      if (picked === undefined) {
        // The same DOM abort a cancelled readline question raises, which callers already read.
        reject(AbortSignal.abort().reason)
      } else {
        resolve(picked)
      }
    }

    process.stdin.on('keypress', onKeypress)
    process.stdin.once('end', onEnd)
  })
}

interface KeyInput {
  readonly key: Key | undefined
  readonly size: number
  readonly current: number
}

function toSelectKey(input: KeyInput): SelectKey | undefined {
  const { key, size, current } = input
  const step = key?.name === undefined ? undefined : STEP_BY_KEY[key.name]

  if (step !== undefined) {
    return { kind: 'move', to: (current + step + size) % size }
  }

  if (key?.name === 'return' || key?.name === 'enter') {
    return { kind: 'pick' }
  }

  if (key?.name === 'escape' || (key?.ctrl === true && key.name === 'c')) {
    return { kind: 'cancel' }
  }

  return undefined
}

/** Draws the question and its options over the `previous` rows the last drawing took, and
 *  returns how many rows this one takes. */
function render(
  question: SelectQuestion<SelectOption>,
  selected: number,
  previous: number
): number {
  const lines = [
    `${ask(question.question)} ${hint(question.hint)}`,
    ...question.options.map((option, index) => optionLine(option, index === selected)),
  ]

  clearRows(previous)
  process.stdout.write(`${lines.join('\n')}\n`)

  return lines.reduce((total, line) => total + rowsOf(line), 0)
}

function optionLine(option: SelectOption, isSelected: boolean): string {
  const marker = isSelected ? style.accent(MENU_MARKER) : ' '
  const label = isSelected ? style.accent(option.label) : option.label
  const note = option.note === undefined ? '' : `  ${hint(option.note)}`

  return `${marker} ${label}${note}`
}

function clearRows(rows: number): void {
  if (rows > 0) {
    process.stdout.write(`\r\u001B[${rows}A${CLEAR_DOWN}`)
  }
}

function rowsOf(line: string): number {
  const columns = Math.max(MIN_COLUMNS, process.stdout.columns || MIN_COLUMNS)

  return Math.max(1, Math.ceil(Bun.stringWidth(line) / columns))
}
