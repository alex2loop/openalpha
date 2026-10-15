import type { DurationResult } from '@/core/utils/time'
import type { HeartbeatSessionMode, HeartbeatTask } from '@/scheduler/heartbeat/types'
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, parseDuration } from '@/core/utils/time'

const MAX_TASKS = 20
const MIN_INTERVAL_MS = MS_PER_MINUTE
const HEARTBEAT_DEFAULT_INTERVAL_MS = MS_PER_HOUR
const HEARTBEAT_TASK_NAME_MAX_CHARS = 128
// Fixed parser safety invariants, not operator defaults: the actual window always comes from
// HEARTBEAT.md. A recognized line with an out-of-range value drops the task rather than silently
// disabling duplicate suppression.
const MIN_DUPLICATE_WINDOW_MS = MS_PER_MINUTE
const MAX_DUPLICATE_WINDOW_MS = 30 * MS_PER_DAY

const HEARTBEAT_NAME_RE = /^-\s*name:\s*(.+)$/
const HEARTBEAT_INTERVAL_RE = /^interval:\s*(\S+)$/
const HEARTBEAT_PROMPT_RE = /^prompt:\s*(.+)$/
const HEARTBEAT_DELIVER_RE = /^deliver:\s*(.+)$/
const HEARTBEAT_SESSION_RE = /^session:\s*(.*)$/
const HEARTBEAT_DUPLICATE_WINDOW_RE = /^duplicate_window:\s*(.*)$/

const HEADING_RE = /^#{1,6}\s/
const FENCE_RE = /^(```+|~~~+)\s*\w*\s*$/
const HTML_COMMENT_RE = /^<!--.*-->\s*$/
const EMPTY_CHECKBOX_RE = /^[-*]\s*\[[ xX]\]\s*$/

interface HeartbeatParseResult {
  readonly context: string
  readonly tasks: readonly HeartbeatTask[]
  readonly dropped: number
}

type HeartbeatParseError = 'invalid_session' | 'invalid_duplicate_window'

type ParsedOptionalField<T> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'invalid' }

interface MutablePartialHeartbeatTask {
  name?: string
  intervalMs?: number
  prompt?: string
  deliver?: readonly string[]
  session?: HeartbeatSessionMode
  duplicateWindowMs?: number
  error?: HeartbeatParseError
}

function hasActionableHeartbeatContent(text: string): boolean {
  return text.split('\n').some(hasActionableContent)
}

function hasActionableContent(line: string): boolean {
  const trimmed = line.trim()

  if (trimmed === '') {
    return false
  }
  if (HEADING_RE.test(trimmed)) {
    return false
  }
  if (FENCE_RE.test(trimmed)) {
    return false
  }
  if (HTML_COMMENT_RE.test(trimmed)) {
    return false
  }
  if (EMPTY_CHECKBOX_RE.test(trimmed)) {
    return false
  }

  return true
}

export function parseHeartbeat(text: string): HeartbeatParseResult {
  const lines = text.split('\n')
  const marker = lines.findIndex((line) => line.trim() === 'tasks:')

  if (marker < 0) {
    return parseImplicitHeartbeat(text)
  }

  const context = lines.slice(0, marker).join('\n').trim()
  const { tasks, dropped } = parseTaskBlocks(lines.slice(marker + 1))
  const bounded = tasks.slice(0, MAX_TASKS)

  return {
    context,
    tasks: bounded,
    dropped: dropped + (tasks.length - bounded.length),
  }
}

function parseImplicitHeartbeat(text: string): HeartbeatParseResult {
  if (!hasActionableHeartbeatContent(text)) {
    return { context: '', tasks: [], dropped: 0 }
  }

  return {
    context: '',
    tasks: [{ name: 'heartbeat', intervalMs: HEARTBEAT_DEFAULT_INTERVAL_MS, prompt: text.trim() }],
    dropped: 0,
  }
}

function parseTaskBlocks(lines: readonly string[]): { tasks: HeartbeatTask[]; dropped: number } {
  const tasks: HeartbeatTask[] = []
  const seen = new Set<string>()
  let current: MutablePartialHeartbeatTask = {}
  let dropped = 0

  const closeBlock = (): void => {
    if (!hasTaskContent(current)) {
      return
    }

    const task = finalizeTask(current, seen)

    if (task === undefined) {
      dropped++
    } else {
      tasks.push(task)
      seen.add(task.name)
    }
  }

  for (const line of lines) {
    const name = parseNameLine(line)

    if (name !== undefined) {
      closeBlock()
      current = { name }
      continue
    }

    current = applyBlockLine(line, current)
  }

  closeBlock()

  return { tasks, dropped }
}

// The seeded empty block holds no task: only a block that captured at least one field can be
// rejected as malformed, so a well-formed file never reports a phantom drop. An `error` field
// counts as captured content so an invalid optional field is reported as a drop, not lost.
function hasTaskContent(current: MutablePartialHeartbeatTask): boolean {
  return (
    current.name !== undefined ||
    current.prompt !== undefined ||
    current.intervalMs !== undefined ||
    current.deliver !== undefined ||
    current.error !== undefined
  )
}

function parseNameLine(line: string): string | undefined {
  const match = HEARTBEAT_NAME_RE.exec(line.trim())

  return match?.[1]?.trim()
}

function applyBlockLine(
  line: string,
  current: MutablePartialHeartbeatTask
): MutablePartialHeartbeatTask {
  const intervalMs = parseIntervalLine(line)

  if (intervalMs !== undefined) {
    return { ...current, intervalMs }
  }

  const prompt = parsePromptLine(line)

  if (prompt !== undefined) {
    return { ...current, prompt }
  }

  const deliver = parseDeliverLine(line)

  if (deliver !== undefined) {
    return { ...current, deliver }
  }

  return applyOptionalBlockLine(line, current)
}

function applyOptionalBlockLine(
  line: string,
  current: MutablePartialHeartbeatTask
): MutablePartialHeartbeatTask {
  const session = parseSessionLine(line)

  if (session.kind === 'value') {
    return { ...current, session: session.value }
  }
  if (session.kind === 'invalid') {
    return { ...current, error: 'invalid_session' }
  }

  const duplicateWindow = parseDuplicateWindowLine(line)

  if (duplicateWindow.kind === 'value') {
    return { ...current, duplicateWindowMs: duplicateWindow.value }
  }
  if (duplicateWindow.kind === 'invalid') {
    return { ...current, error: 'invalid_duplicate_window' }
  }

  return current
}

function parseIntervalLine(line: string): number | undefined {
  const match = HEARTBEAT_INTERVAL_RE.exec(line.trim())

  if (match === null) {
    return undefined
  }

  return parseInterval(match[1] ?? '')
}

function parsePromptLine(line: string): string | undefined {
  const match = HEARTBEAT_PROMPT_RE.exec(line.trim())

  return match?.[1]?.trim()
}

function parseDeliverLine(line: string): readonly string[] | undefined {
  const match = HEARTBEAT_DELIVER_RE.exec(line.trim())

  if (match === null) {
    return undefined
  }

  const values = match[1]
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (values === undefined || values.length === 0) {
    return undefined
  }

  return values
}

function parseSessionLine(line: string): ParsedOptionalField<HeartbeatSessionMode> {
  const match = HEARTBEAT_SESSION_RE.exec(line.trim())

  if (match === null) {
    return { kind: 'absent' }
  }

  const value = match[1]?.trim()

  if (value === 'shared' || value === 'isolated') {
    return { kind: 'value', value }
  }

  return { kind: 'invalid' }
}

function parseDuplicateWindowLine(line: string): ParsedOptionalField<number> {
  const match = HEARTBEAT_DUPLICATE_WINDOW_RE.exec(line.trim())

  if (match === null) {
    return { kind: 'absent' }
  }

  const result: DurationResult = parseDuration(match[1] ?? '')

  if (
    result.kind !== 'value' ||
    result.ms < MIN_DUPLICATE_WINDOW_MS ||
    result.ms > MAX_DUPLICATE_WINDOW_MS
  ) {
    return { kind: 'invalid' }
  }

  return { kind: 'value', value: result.ms }
}

function parseInterval(raw: string): number | undefined {
  const result: DurationResult = parseDuration(raw)

  if (result.kind !== 'value') {
    return undefined
  }
  if (result.ms < MIN_INTERVAL_MS) {
    return undefined
  }

  return result.ms
}

function finalizeTask(
  current: MutablePartialHeartbeatTask,
  seen: Set<string>
): HeartbeatTask | undefined {
  const name = current.name?.trim()
  const prompt = current.prompt?.trim()

  if (
    name === undefined ||
    name === '' ||
    name.length > HEARTBEAT_TASK_NAME_MAX_CHARS ||
    prompt === undefined ||
    prompt === '' ||
    current.intervalMs === undefined ||
    current.error !== undefined ||
    seen.has(name)
  ) {
    return undefined
  }

  return {
    name,
    intervalMs: current.intervalMs,
    prompt,
    ...optionalTaskFields(current),
  }
}

function optionalTaskFields(current: MutablePartialHeartbeatTask): Partial<HeartbeatTask> {
  return {
    ...(current.deliver === undefined ? {} : { deliver: current.deliver }),
    ...(current.session === undefined ? {} : { session: current.session }),
    ...(current.duplicateWindowMs === undefined
      ? {}
      : { duplicateWindowMs: current.duplicateWindowMs }),
  }
}
