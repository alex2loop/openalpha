import type { FileEditArgs } from '@/tools/fs/file-edit'
import { ToolError } from '@/core/errors'

interface FuzzyLine {
  readonly start: number
  readonly text: string
}

export function applyEdit(
  text: string,
  args: FileEditArgs
): { readonly newContent: string; readonly replaced: number; readonly fuzzy: boolean } {
  const matches = text.split(args.old_text).length - 1

  if (matches === 0) {
    if (args.replace_all || args.expected_count !== 1) {
      throw new ToolError(
        'invalid_input',
        'fuzzy match requires a single expected occurrence and replace_all=false'
      )
    }

    const fuzzy = fuzzyFind(text, args.old_text)

    if (fuzzy === null) {
      throw new ToolError('invalid_input', 'old_text not found in file')
    }

    const newContent =
      text.slice(0, fuzzy.index) + args.new_text + text.slice(fuzzy.index + fuzzy.length)

    return { newContent, replaced: 1, fuzzy: true }
  }

  if (!args.replace_all && matches !== args.expected_count) {
    throw new ToolError(
      'invalid_input',
      `expected ${args.expected_count} occurrence(s) of old_text, found ${matches}`
    )
  }

  return {
    newContent: text.split(args.old_text).join(args.new_text),
    replaced: matches,
    fuzzy: false,
  }
}

// Line-anchored, not a raw substring search: each line of old_text (its own leading whitespace
// trimmed) must equal the corresponding file line (same trim) at a contiguous, in-order run. A
// second alignment refuses the edit outright rather than silently taking the first one — an
// indentation-tolerant match that isn't unique isn't safe to apply.
function fuzzyFind(
  text: string,
  oldText: string
): { readonly index: number; readonly length: number } | null {
  const textLines = linesWithOffsets(text)
  const oldLines = oldText.split('\n').map((line) => line.trimStart())
  let match: { readonly index: number; readonly length: number } | undefined

  for (let start = 0; start + oldLines.length <= textLines.length; start++) {
    if (!alignsAt(textLines, start, oldLines)) {
      continue
    }

    const span = spanOf(textLines, start, oldLines.length)

    if (span === undefined) {
      continue
    }

    if (match !== undefined) {
      return null
    }

    match = span
  }

  return match ?? null
}

function linesWithOffsets(text: string): readonly FuzzyLine[] {
  const lines: FuzzyLine[] = []
  let offset = 0

  for (const line of text.split('\n')) {
    lines.push({ start: offset, text: line })
    offset += line.length + 1
  }

  return lines
}

function alignsAt(
  textLines: readonly FuzzyLine[],
  start: number,
  oldLines: readonly string[]
): boolean {
  return oldLines.every(
    (line, offset) => (textLines[start + offset]?.text.trimStart() ?? null) === line
  )
}

function spanOf(
  textLines: readonly FuzzyLine[],
  start: number,
  lineCount: number
): { readonly index: number; readonly length: number } | undefined {
  const first = textLines[start]
  const last = textLines[start + lineCount - 1]

  if (first === undefined || last === undefined) {
    return undefined
  }

  return { index: first.start, length: last.start + last.text.length - first.start }
}
