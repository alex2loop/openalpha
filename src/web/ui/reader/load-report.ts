import type { BriefTextWire, SuggestionCardWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { parseReport, plainTextOf, type ReportDoc, toPlain } from '@/web/ui/markdown/parse'

const ASSISTANT_ROLE = 'assistant'
// A page of history can hold only empty rows; the newest answer is rarely further back than this.
const HISTORY_PAGES_MAX = 4
const TITLE_MAX_CHARS = 80
const ELLIPSIS = '...'
const DETAIL_TITLE = /^\*\*(.+)\*\*$/
const LINE_BREAK = /\r?\n/

export type ReaderSource =
  | { readonly kind: 'brief' }
  | { readonly kind: 'research'; readonly sessionId: string }
  | { readonly kind: 'suggestion'; readonly id: string }

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
      return await loadResearch(source.sessionId, abort)
    case 'suggestion':
      return await loadSuggestion(source.id, abort)
  }
}

// The brief's book sections carry amounts, cost, quantity, return and fill that no model may see,
// so a passage of it is never quoted into a question.
async function loadBrief(abort: AbortSignal): Promise<ReaderContent | undefined> {
  const answer = await getJson(ROUTES.brief, { signal: abort })

  return answer.text === null ? undefined : toContent(briefMarkdown(answer.text), false)
}

async function loadResearch(
  sessionId: string,
  abort: AbortSignal
): Promise<ReaderContent | undefined> {
  const text = await readNewestAnswer(sessionId, abort)

  return text === undefined ? undefined : toContent(text, true)
}

async function loadSuggestion(id: string, abort: AbortSignal): Promise<ReaderContent | undefined> {
  const answer = await getJson(ROUTES.suggestionCard(id), { signal: abort })

  return answer.card === null ? undefined : toContent(cardMarkdown(answer.card), true)
}

// The run's session may carry later talk; the report is the newest answer in it.
async function readNewestAnswer(
  sessionId: string,
  abort: AbortSignal
): Promise<string | undefined> {
  let before: number | undefined

  for (let page = 0; page < HISTORY_PAGES_MAX; page++) {
    const answer = await getJson(ROUTES.chatHistory(sessionId), {
      ...(before === undefined ? {} : { query: { before } }),
      signal: abort,
    })
    const found = answer.messages.find(
      (message) => message.role === ASSISTANT_ROLE && message.content.trim() !== ''
    )

    if (found !== undefined) {
      return found.content
    }

    if (!answer.hasMore || answer.nextBefore === null) {
      return undefined
    }

    before = answer.nextBefore
  }

  return undefined
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

function cardMarkdown(card: SuggestionCardWire): string {
  const bulleted = [card.facts, card.reasons, card.levels, card.notes]
    .filter((lines) => lines.length > 0)
    .map(toBullets)

  return [
    card.verdict,
    ...bulleted,
    ...(card.calibration === undefined ? [] : [card.calibration]),
    ...card.details.map(toDetailMarkdown),
    card.disclaimer,
  ].join('\n\n')
}

// A detail block opens with its bold title; the reader makes it a heading so the contents list it.
function toDetailMarkdown(block: readonly string[]): string {
  const [first = '', ...rest] = block
  const title = DETAIL_TITLE.exec(first)

  return title === null ? block.join('\n') : `## ${title[1]}\n\n${rest.join('\n')}`
}

function toBullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}
