import { PUBLIC_BRIEF_WIRE_SCHEMA, type PublicBriefDocument } from '@/app/server/wire/public-brief'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const STORY_ROLES: ReadonlySet<unknown> = new Set([
  'title',
  'heading',
  'lead',
  'row',
  'note',
  'source',
])
const SECTION_STATUSES: ReadonlySet<unknown> = new Set(['ready', 'unavailable'])

type Test = (value: unknown) => boolean

const isStoryLine = isShape({ role: isOneOf(STORY_ROLES), text: isText })
const isSection = isShape({
  id: isText,
  kind: isText,
  status: isOneOf(SECTION_STATUSES),
  heading: isText,
  lines: isArrayOf(isText),
  block: optional(isText),
  market: optional(isText),
  depths: optional(isArrayOf(isNumber)),
  folded: optional(isTrue),
})
const isBrief = isShape({
  title: isText,
  verdictTitle: optional(isText),
  verdict: isArrayOf(isText),
  readingLines: isNumber,
  nextActions: optional(isArrayOf(isText)),
  story: isArrayOf(isStoryLine),
  sections: isArrayOf(isSection),
  caveats: isArrayOf(isText),
})
const isScreen = isShape({
  market: isText,
  title: isText,
  note: isText,
  rows: isArrayOf(isShape({ ticker: isText, line: isText })),
})

/** Whether `value` has every field the page reads, in both languages. A document that fails would
 *  throw while it renders, so it is neither shown nor kept for offline. */
export function isDocument(value: unknown): value is PublicBriefDocument {
  return (
    isRecord(value) &&
    value.schema === PUBLIC_BRIEF_WIRE_SCHEMA &&
    typeof value.day === 'string' &&
    DAY_RE.test(value.day) &&
    hasBothLocales(value.briefs, isBrief) &&
    hasBothLocales(value.screens, isArrayOf(isScreen)) &&
    hasBothLocales(value.headline, isText)
  )
}

function hasBothLocales(value: unknown, test: Test): boolean {
  return isRecord(value) && test(value.vi) && test(value.en)
}

function isShape(fields: Readonly<Record<string, Test>>): Test {
  return (value) =>
    isRecord(value) && Object.entries(fields).every(([key, test]) => test(value[key]))
}

function isArrayOf(test: Test): Test {
  return (value) => Array.isArray(value) && value.every(test)
}

function isOneOf(allowed: ReadonlySet<unknown>): Test {
  return (value) => allowed.has(value)
}

function optional(test: Test): Test {
  return (value) => value === undefined || test(value)
}

function isText(value: unknown): boolean {
  return typeof value === 'string'
}

function isNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTrue(value: unknown): boolean {
  return value === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
