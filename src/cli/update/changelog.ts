import type { Locale } from '@/core/types/locale'

const RELEASE_HEADING_RE = /^## \[(\d+\.\d+\.\d+)\](.*)$/
const IMPORTANT_TAG = '[IMPORTANT]'
const SECTION_PREFIX = '## '
const SUBSECTION_PREFIX = '### '
const QUOTE_MARK = '>'
const ITEM_PREFIX = '- '
const HEADING_MARK = '#'
const LINE_BREAK_RE = /\r?\n/

type ReleaseSummary = Readonly<Partial<Record<Locale, string>>>

export interface ReleaseNote {
  readonly version: string
  readonly important: boolean
  readonly summary: ReleaseSummary
}

function isQuote(line: string): boolean {
  return line.startsWith(QUOTE_MARK)
}

function isSummaryText(line: string): boolean {
  return !(line.startsWith(ITEM_PREFIX) || isQuote(line) || line.startsWith(HEADING_MARK))
}

/** A blank line, or a switch between quoted and plain lines, ends a paragraph. */
function toParagraphs(lines: readonly string[]): readonly (readonly string[])[] {
  const paragraphs: string[][] = []
  let current: string[] | null = null

  for (const line of lines) {
    if (line.trim() === '') {
      current = null
    } else if (current !== null && isQuote(current[0] ?? '') === isQuote(line)) {
      current.push(line)
    } else {
      current = [line]
      paragraphs.push(current)
    }
  }

  return paragraphs
}

function joinParagraph(paragraph: readonly string[]): string {
  return paragraph.map((line) => line.replace(QUOTE_MARK, '').trim()).join(' ')
}

function toSummary(body: readonly string[]): ReleaseSummary {
  const paragraphs = toParagraphs(body)
  const english = paragraphs.find((paragraph) => isSummaryText(paragraph[0] ?? ''))
  const vietnamese = paragraphs.find((paragraph) => isQuote(paragraph[0] ?? ''))

  return {
    ...(english === undefined ? {} : { en: joinParagraph(english) }),
    ...(vietnamese === undefined ? {} : { vi: joinParagraph(vietnamese) }),
  }
}

interface Section {
  readonly heading: RegExpExecArray
  readonly body: string[]
}

/** A section's summary sits above its first `### ` subsection, so the body stops there. */
function toSections(text: string): readonly Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  let inSummary = false

  for (const line of text.split(LINE_BREAK_RE)) {
    if (line.startsWith(SECTION_PREFIX)) {
      const heading = RELEASE_HEADING_RE.exec(line)

      current = heading === null ? null : { heading, body: [] }
      inSummary = current !== null

      if (current !== null) {
        sections.push(current)
      }
    } else if (line.startsWith(SUBSECTION_PREFIX)) {
      inSummary = false
    } else if (inSummary) {
      current?.body.push(line)
    }
  }

  return sections
}

/** Released sections only, in the order the file lists them (newest first); `[Unreleased]` never matches. */
export function parseChangelog(text: string): readonly ReleaseNote[] {
  return toSections(text).map(({ heading, body }) => ({
    version: heading[1] ?? '',
    important: (heading[2] ?? '').includes(IMPORTANT_TAG),
    summary: toSummary(body),
  }))
}
