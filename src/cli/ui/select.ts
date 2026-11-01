import type { Key } from 'node:readline'
import { emitKeypressEvents } from 'node:readline'

import type { TerminalInput, TerminalOutput } from '@/cli/terminal'
import { currentTerminal } from '@/cli/terminal'
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
  /** Left goes back to the question before this one. */
  readonly back?: true
}

interface Screen {
  readonly out: TerminalOutput
  readonly question: SelectQuestion<SelectOption>
}

type SelectKey =
  | { readonly kind: 'move'; readonly to: number }
  | { readonly kind: 'pick' }
  | { readonly kind: 'back' }
  | { readonly kind: 'cancel' }

/** Up and Down move the mark, Enter picks, Escape, Ctrl-C or a closed terminal cancels with the
 *  abort a cancelled question raises. Leaves one answered line in place of the menu; undefined is
 *  Left on a question that allows going back, and erases the menu. Raw mode, the cursor and every
 *  keypress listener another prompt held are restored on every path. */
export async function selectOption<O extends SelectOption>(
  question: SelectQuestion<O>
): Promise<O | undefined> {
  const { stdin, stdout } = currentTerminal()
  const screen = { out: stdout, question }
  const wasRaw = stdin.isRaw
  const restoreKeys = suspendKeypressListeners(stdin)
  let rows = 0

  try {
    emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()
    stdout.write(HIDE_CURSOR)
    rows = render(screen, question.selected, rows)

    const picked = await readSelection(question, stdin, (to) => {
      rows = render(screen, to, rows)
    })

    clearRows(stdout, rows)

    if (picked !== undefined) {
      stdout.write(`${ask(question.question)} ${style.accent(picked.label)}\n`)
    }

    return picked
  } finally {
    stdout.write(SHOW_CURSOR)
    stdin.setRawMode(wasRaw)
    restoreKeys()
  }
}

function readSelection<O extends SelectOption>(
  question: SelectQuestion<O>,
  input: TerminalInput,
  move: (to: number) => void
): Promise<O | undefined> {
  let current = question.selected

  return new Promise((resolve, reject) => {
    const onKeypress = (_character: string | undefined, key: Key | undefined): void => {
      const action = toSelectKey({
        key,
        size: question.options.length,
        current,
        back: question.back === true,
      })

      if (action?.kind === 'move') {
        current = action.to
        move(current)
        return
      }

      if (action !== undefined) {
        settle(action.kind === 'pick' ? question.options[current] : action.kind)
      }
    }
    const onEnd = (): void => settle('cancel')
    const settle = (answer: O | 'back' | 'cancel' | undefined): void => {
      input.off('keypress', onKeypress)
      input.off('end', onEnd)

      if (answer === 'back') {
        resolve(undefined)
      } else if (answer === 'cancel' || answer === undefined) {
        // The same DOM abort a cancelled readline question raises, which callers already read.
        reject(AbortSignal.abort().reason)
      } else {
        resolve(answer)
      }
    }

    input.on('keypress', onKeypress)
    input.once('end', onEnd)
  })
}

interface KeyInput {
  readonly key: Key | undefined
  readonly size: number
  readonly current: number
  readonly back: boolean
}

function toSelectKey(input: KeyInput): SelectKey | undefined {
  const { key, size, current, back } = input
  const step = key?.name === undefined ? undefined : STEP_BY_KEY[key.name]

  if (step !== undefined) {
    return { kind: 'move', to: (current + step + size) % size }
  }

  if (key?.name === 'return' || key?.name === 'enter') {
    return { kind: 'pick' }
  }

  if (back && key?.name === 'left') {
    return { kind: 'back' }
  }

  if (key?.name === 'escape' || (key?.ctrl === true && key.name === 'c')) {
    return { kind: 'cancel' }
  }

  return undefined
}

/** Draws the question and its options over the `previous` rows the last drawing took, and
 *  returns how many rows this one takes. */
function render(screen: Screen, selected: number, previous: number): number {
  const { out, question } = screen
  const lines = [
    `${ask(question.question)} ${hint(question.hint)}`,
    ...question.options.map((option, index) => optionLine(option, index === selected)),
  ]

  clearRows(out, previous)
  out.write(`${lines.join('\n')}\n`)

  return lines.reduce((total, line) => total + rowsOf(out, line), 0)
}

function optionLine(option: SelectOption, isSelected: boolean): string {
  const marker = isSelected ? style.accent(MENU_MARKER) : ' '
  const label = isSelected ? style.accent(option.label) : option.label
  const note = option.note === undefined ? '' : `  ${hint(option.note)}`

  return `${marker} ${label}${note}`
}

function clearRows(out: TerminalOutput, rows: number): void {
  if (rows > 0) {
    out.write(`\r\u001B[${rows}A${CLEAR_DOWN}`)
  }
}

function rowsOf(out: TerminalOutput, line: string): number {
  const columns = Math.max(MIN_COLUMNS, out.columns || MIN_COLUMNS)

  return Math.max(1, Math.ceil(Bun.stringWidth(line) / columns))
}
