import type { LLMMessage } from '@/core/llm'
import type { RunView, TodoSlot } from '@/engine/types/run'
import { textOf } from '@/core/utils/message'

// Bracket markers, not XML: tool results are XML-escaped into the transcript, so a `<todo_list>`
// tag would be stored as `&lt;todo_list&gt;` and never match again.
const TODO_OPENING = '[todo_list]\n'
const TODO_CLOSING = '\n[/todo_list]'
export const TODO_RESTORED_NOTICE =
  'Your todo list is still active. Older messages were compacted away, so here it is again:'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** One column wide so the three states stay aligned, and fixed rather than derived from the
 *  terminal: the transcript keeps the checklist verbatim, so a capability-dependent glyph would
 *  make the model's own history vary by machine. Never `x` — that is the surface's error icon, and
 *  a finished step must not wear the marker a failed one does. A surface that wants prettier
 *  markers maps these through `toTodoSteps`; it never changes what is written. */
export const TODO_GLYPHS: Readonly<Record<TodoStatus, string>> = Object.freeze({
  pending: '[ ]',
  in_progress: '[>]',
  completed: '[\u2713]',
})

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

export interface TodoStep {
  readonly status: TodoStatus
  readonly text: string
}

interface TodoScan {
  readonly fromTool?: string
  readonly visible: boolean
}

export function createTodoSlot(): TodoSlot {
  let checklist: string | undefined

  return {
    current: () => checklist,
    set(next): void {
      checklist = next
    },
  }
}

export function formatTodoBlock(checklist: string): string {
  return `${TODO_OPENING}${checklist}${TODO_CLOSING}`
}

export function todoChecklistOf(text: string): string | undefined {
  const start = text.indexOf(TODO_OPENING)

  if (start < 0) {
    return undefined
  }

  const end = text.indexOf(TODO_CLOSING, start)

  return end < 0 ? undefined : text.slice(start + TODO_OPENING.length, end)
}

// Reads the rendered checklist back into steps so a surface can style each state without knowing
// which tool produced it. All-or-nothing: a summarizer's paraphrase must never render as a plan.
export function toTodoSteps(checklist: string): readonly TodoStep[] | undefined {
  const steps: TodoStep[] = []

  for (const line of checklist.split('\n')) {
    const trimmed = line.trim()

    if (trimmed === '') {
      continue
    }

    const step = toTodoStep(trimmed)

    if (step === undefined) {
      return undefined
    }

    steps.push(step)
  }

  return steps.length === 0 ? undefined : steps
}

// A plan summary is `<counter>\n<checklist>`: the counter is the surface's live line, the steps are
// the plan itself.
export function toPlanSteps(summary: string): readonly TodoStep[] | undefined {
  const newline = summary.indexOf('\n')

  return newline < 0 ? undefined : toTodoSteps(summary.slice(newline + 1))
}

function toTodoStep(line: string): TodoStep | undefined {
  for (const status of TODO_STATUSES) {
    const glyph = TODO_GLYPHS[status]

    if (line.startsWith(glyph)) {
      return { status, text: line.slice(glyph.length).trim() }
    }
  }

  return undefined
}

// Compaction summarizes the middle window and the message cap trims whole groups; either drops the
// list the agent is working from. Re-appending only once the transcript stops showing it costs one
// message per compaction instead of one per turn.
export function restoreTodoList(run: RunView): void {
  const scan = scanTodoList(run.state.messages.history)

  if (scan.fromTool !== undefined) {
    run.state.todo.set(scan.fromTool)
  }

  const checklist = run.state.todo.current()

  if (checklist === undefined || scan.visible) {
    return
  }

  // Transient: persisting it would render in `history show` and the chat API as a user message.
  run.state.messages.appendTransient({
    role: 'user',
    content: `${TODO_RESTORED_NOTICE}\n${formatTodoBlock(checklist)}`,
  })
}

// Newest-first, and only the tool's own result refreshes the slot: a summarizer that paraphrases
// the list into its recap must not overwrite what the agent actually wrote.
function scanTodoList(history: readonly LLMMessage[]): TodoScan {
  let visible = false

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]

    if (message?.role === 'user') {
      visible ||= textOf(message.content).startsWith(TODO_RESTORED_NOTICE)
      continue
    }

    if (message?.role !== 'tool') {
      continue
    }

    const checklist = todoChecklistOf(textOf(message.content))

    if (checklist !== undefined) {
      return { fromTool: checklist, visible: true }
    }
  }

  return { visible }
}
