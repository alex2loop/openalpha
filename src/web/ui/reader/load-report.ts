import type { BriefTextWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { toPlain } from '@/web/ui/markdown/inline'
import { parseReport, plainTextOf, type ReportDoc } from '@/web/ui/markdown/parse'

const ASSISTANT_ROLE = 'assistant'
const TITLE_MAX_CHARS = 80
const ELLIPSIS = '...'
const LINE_BREAK = /\r?\n/

export type ReaderSource =
  | { readonly kind: 'brief' }
  | { readonly kind: 'research'; readonly sessionId: string; readonly runId: string }

export interface ReaderContent {
  readonly title: string
  readonly doc: ReportDoc
  /** The passage can be quoted into a question for the model. */
  readonly canAsk: boolean
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

  return answer.text === null ? undefined : toContent(briefMarkdown(answer.text), false)
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

  return report === undefined ? undefined : toContent(report.content, true)
}

// A first level-one heading is the title; else the first line, cut.
function toContent(markdown: string, canAsk: boolean): ReaderContent | undefined {
  const parsed = parseReport(markdown)
  const first = parsed.blocks[0]

  if (first?.kind === 'heading' && first.level === 1) {
    return {
      title: toPlain(first.inline),
      doc: { ...parsed, blocks: parsed.blocks.slice(1), headings: parsed.headings.slice(1) },
      canAsk,
    }
  }

  const lead = plainTextOf(parsed)
    .split(LINE_BREAK)
    .find((line) => line.trim() !== '')

  return lead === undefined ? undefined : { title: cut(lead.trim()), doc: parsed, canAsk }
}

function cut(line: string): string {
  return line.length > TITLE_MAX_CHARS
    ? `${line.slice(0, TITLE_MAX_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
    : line
}

function briefMarkdown(text: BriefTextWire): string {
  const sections = text.sections.map(
    (section) => `## ${section.heading}\n\n${toBullets(section.lines)}`
  )

  return [
    `# ${text.title}`,
    ...text.verdict,
    ...text.story,
    ...sections,
    ...(text.caveats.length === 0 ? [] : [toBullets(text.caveats)]),
  ].join('\n\n')
}

function toBullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}
