const FENCE = '---'
const KEY_VAL_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/
const LIST_ITEM_RE = /^(\s*)-\s+(.*)$/
const LIST_SEPARATOR = ', '

interface ParseState {
  readonly result: Record<string, string>
  readonly stack: { indent: number; key: string }[]
}

// Flat map with dot-joined keys for nested mappings, so a skill nesting under
// `metadata.hermes.requires_tools: a, b` surfaces as that exact key.
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.split('\n')

  if (lines[0]?.trim() !== FENCE) {
    return {}
  }

  const state: ParseState = { result: {}, stack: [] }

  for (const line of lines.slice(1)) {
    if (line.trim() === FENCE) {
      break
    }

    consumeLine(state, line)
  }

  return state.result
}

// The body after the closing fence. Text with no leading fence passes through unchanged. Used when a
// SKILL.md body is reused as an agent system prompt, where the frontmatter is noise.
export function stripFrontmatter(text: string): string {
  const lines = text.split('\n')

  if (lines[0]?.trim() !== FENCE) {
    return text
  }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FENCE) {
      return lines
        .slice(i + 1)
        .join('\n')
        .trimStart()
    }
  }

  return text
}

function consumeLine(state: ParseState, line: string): void {
  const trimmed = line.trim()

  if (trimmed === '' || trimmed.startsWith('#')) {
    return
  }

  const item = LIST_ITEM_RE.exec(line)

  if (item !== null) {
    appendListItem(state, item[2] ?? '')
    return
  }

  const match = KEY_VAL_RE.exec(line)

  if (match === null) {
    return
  }

  const indent = (match[1] ?? '').length
  const key = match[2] ?? ''
  const value = match[3] ?? ''

  popClosedScopes(state.stack, indent)

  if (value.trim() === '') {
    state.stack.push({ indent, key })
    return
  }

  state.result[joinKey(state.stack, key)] = unquote(value)
}

/** A `- item` line belongs to the innermost open key; items accumulate as one comma list so the
 *  metadata reader splits them the same way it splits an inline list. */
function appendListItem(state: ParseState, raw: string): void {
  const open = state.stack.at(-1)

  if (open === undefined) {
    return
  }

  const key = joinKey(state.stack.slice(0, -1), open.key)
  const item = unquote(raw)
  const existing = state.result[key]

  state.result[key] = existing === undefined ? item : `${existing}${LIST_SEPARATOR}${item}`
}

function joinKey(stack: readonly { readonly key: string }[], key: string): string {
  const prefix = stack.map((frame) => frame.key).join('.')

  return prefix === '' ? key : `${prefix}.${key}`
}

function popClosedScopes(stack: ParseState['stack'], indent: number): void {
  while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) {
    stack.pop()
  }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))

  return quoted ? trimmed.slice(1, -1) : trimmed
}
