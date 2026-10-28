import type { BriefTextWire } from '@/app/server/wire/brief'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { joinInline, splitInline } from '@/web/text/glyphs'
import { toPlain } from '@/web/ui/markdown/inline'
import { parseReport, plainTextOf, type ReportDoc } from '@/web/ui/markdown/parse'

const ASSISTANT_ROLE = 'assistant'
const TITLE_MAX_CHARS = 80
const ELLIPSIS = '...'
const LINE_BREAK = /\r?\n/
const TRAILING_COLON = /\s*:+$/

export type ReaderSource =
  | { readonly kind: 'brief' }
  | { readonly kind: 'research'; readonly sessionId: string; readonly runId: string }

/** A report is markdown from a model; the brief is the daemon's own lines, laid out by their roles. */
export type ReaderContent =
  | {
      readonly kind: 'report'
      readonly title: string
      readonly doc: ReportDoc
    }
  | {
      readonly kind: 'brief'
      readonly title: string
      /** The day and read time, on a line of their own under the title. */
      readonly meta: string
      readonly text: BriefTextWire
    }

/** Reads the report behind `source`; absent when the daemon holds no text for it. */
export async function loadReport(
  source: ReaderSource,
  abort: AbortSignal
): Promise<ReaderContent | undefined> {
  switch (source.kind) {
    case 'brief':
      return await loadBrief(abort)
    case 'research':
      return await loadResearch(source, abort)
  }
}

// The brief's book sections carry amounts, cost, quantity, return and fill that no model may see,
// so a passage of it is never quoted into a question.
async function loadBrief(abort: AbortSignal): Promise<ReaderContent | undefined> {
  const answer = await getJson(ROUTES.brief, { signal: abort })
  const { text } = answer

  if (text === null) {
    return undefined
  }

  const [title = '', ...rest] = splitInline(text.title)

  return { kind: 'brief', title, meta: joinInline(rest), text }
}

async function loadResearch(
  source: Extract<ReaderSource, { readonly kind: 'research' }>,
  abort: AbortSignal
): Promise<ReaderContent | undefined> {
  const answer = await getJson(ROUTES.chatHistory(source.sessionId), {
    query: { runId: source.runId },
    signal: abort,
  })
  // The run's last reply with text is the report; its earlier ones narrate the tool calls.
  const report = answer.messages.findLast((message) => message.role === ASSISTANT_ROLE)

  return report === undefined ? undefined : toContent(report.content)
}

// A first level-one heading is the title; else the first line, cut.
function toContent(markdown: string): ReaderContent | undefined {
  const parsed = parseReport(markdown)
  const first = parsed.blocks[0]

  if (first?.kind === 'heading' && first.level === 1) {
    return {
      kind: 'report',
      title: toTitle(toPlain(first.inline)),
      doc: { ...parsed, blocks: parsed.blocks.slice(1), headings: parsed.headings.slice(1) },
    }
  }

  const lead = plainTextOf(parsed)
    .split(LINE_BREAK)
    .find((line) => line.trim() !== '')

  return lead === undefined ? undefined : leadTitled(parsed, lead.trim())
}

// The title is the first line; when that line stands alone as the first paragraph, the body does not
// say it again.
function leadTitled(parsed: ReportDoc, lead: string): ReaderContent {
  const [first, ...rest] = parsed.blocks
  const isRepeat =
    first?.kind === 'paragraph' && toPlain(first.inline).trim() === lead && cut(lead) === lead

  return {
    kind: 'report',
    title: toTitle(cut(lead)),
    doc: isRepeat ? { ...parsed, blocks: rest } : parsed,
  }
}

// A model ends a lead-in line with a colon; a title does not.
function toTitle(line: string): string {
  return line.replace(TRAILING_COLON, '')
}

function cut(line: string): string {
  return line.length > TITLE_MAX_CHARS
    ? `${line.slice(0, TITLE_MAX_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
    : line
}
