import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import { ToolError } from '@/core/errors'
import { createTool } from '@/core/tool'
import { formatTodoBlock, TODO_GLYPHS, todoChecklistOf, toTodoSteps } from '@/engine/api'

const TODO_MAX_ITEMS = 20
const TODO_TEXT_MAX_LEN = 120
const TODO_REMINDER = 'Keep working the in_progress item; call todo_write again as items finish.'
const TODO_DESCRIPTION = `Plan a turn of three or more distinct steps, a multi-item list the user gave, or any turn that runs long opaque work. Skip single-step and conversational turns.
Send the whole list every call, with unique content per item and at most one in_progress. Set that item before its step starts and move it before the next one begins, never after. Mark completed only on full success; on failure leave it in_progress and add an item for the blocker.`

const todoItemSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(TODO_TEXT_MAX_LEN)
    .describe('Imperative step, such as "Size the position".'),
  status: z
    .enum(['pending', 'in_progress', 'completed'])
    .describe(
      'pending before it starts, in_progress while it runs (at most one), completed only on full success.'
    ),
})

const todoListSchema = z.object({
  items: z
    .array(todoItemSchema)
    .min(1)
    .max(TODO_MAX_ITEMS)
    .describe(`The whole list every call, 1 to ${TODO_MAX_ITEMS} items.`),
})

type TodoItem = z.infer<typeof todoItemSchema>

export const todoWriteTool = createTool({
  name: 'todo_write',
  description: TODO_DESCRIPTION,
  inputSchema: todoListSchema,
  inputExamples: [
    {
      items: [
        { content: 'Read the current position', status: 'completed' },
        { content: 'Size the add', status: 'in_progress' },
        { content: 'Write the suggestion', status: 'pending' },
      ],
    },
  ],
  capability: 'read',
  presentation: { label: 'Plan', emoji: '📋' },
  eager: true,
  summarizeResult: summarizeTodoList,
  async execute(args): Promise<string> {
    assertTodoList(args.items)

    // Rendered, not JSON: the loop lifts this block back into a compacted transcript verbatim.
    const checklist = args.items.map(toChecklistLine).join('\n')

    return `${formatTodoBlock(checklist)}\n${TODO_REMINDER}`
  },
})

function assertTodoList(items: readonly TodoItem[]): void {
  const seen = new Set<string>()
  let active = 0

  for (const item of items) {
    const key = item.content.trim().toLowerCase()

    if (seen.has(key)) {
      throw new ToolError('invalid_input', `duplicate todo content: ${item.content}`)
    }
    seen.add(key)

    if (item.status === 'in_progress') {
      active += 1
    }
  }

  if (active > 1) {
    throw new ToolError(
      'invalid_input',
      `${active} items are in_progress; at most one step may be active`
    )
  }
}

// Counter plus the whole list on every call: with one line changed per call a delta reads as an
// isolated fact, while the list re-read against a moving counter is what shows what is left.
function summarizeTodoList(content: string): DisplayText | undefined {
  // Scrubbing or truncation can leave the block unterminated; no checklist then.
  const checklist = todoChecklistOf(content)

  if (checklist === undefined) {
    return undefined
  }

  const steps = toTodoSteps(checklist)

  if (steps === undefined) {
    return undefined
  }

  const completed = steps.filter((step) => step.status === 'completed').length
  const params = { completed, total: steps.length, checklist }

  return completed === steps.length
    ? { key: 'toolSummaries.todoComplete', params }
    : { key: 'toolSummaries.todoProgress', params }
}

// One text per step, in every state: a step that reworded itself when it started would read as a
// different step, and the surface that wants "doing X now" has the status glyph to say it with.
function toChecklistLine(item: TodoItem): string {
  return `  ${TODO_GLYPHS[item.status]} ${item.content}`
}
