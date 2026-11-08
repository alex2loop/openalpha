import { PUBLIC_BRIEF_WIRE_SCHEMA, type PublicBriefDocument } from './public-brief'

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

type Guard = (value: unknown) => boolean

const isStoryLine = shapeGuard({ role: choiceGuard(STORY_ROLES), text: isText })
const isSection = shapeGuard({
  id: isText,
  kind: isText,
  status: choiceGuard(SECTION_STATUSES),
  heading: isText,
  lines: arrayGuard(isText),
  block: optionalGuard(isText),
  market: optionalGuard(isText),
  depths: optionalGuard(arrayGuard(isNumber)),
  folded: optionalGuard(isTrue),
})
const isBrief = shapeGuard({
  title: isText,
  strip: optionalGuard(arrayGuard(isText)),
  verdictTitle: optionalGuard(isText),
  verdict: arrayGuard(isText),
  readingLines: isNumber,
  nextActions: optionalGuard(arrayGuard(isText)),
  story: arrayGuard(isStoryLine),
  sections: arrayGuard(isSection),
  caveats: arrayGuard(isText),
})
const isScreen = shapeGuard({
  market: isText,
  title: isText,
  note: isText,
  rows: arrayGuard(shapeGuard({ ticker: isText, line: isText })),
})

/** Whether `value` has every field the page reads, in both languages. The Worker refuses a
 *  document that fails (it would be stored for good), and the app neither shows nor keeps one (it
 *  would throw while it renders). Pure: the Worker, the service worker and the page all load it. */
export function isDocument(value: unknown): value is PublicBriefDocument {
  return (
    isRecord(value) &&
    value.schema === PUBLIC_BRIEF_WIRE_SCHEMA &&
    typeof value.day === 'string' &&
    DAY_RE.test(value.day) &&
    hasBothLocales(value.briefs, isBrief) &&
    hasBothLocales(value.screens, arrayGuard(isScreen)) &&
    hasBothLocales(value.headline, isText)
  )
}

function hasBothLocales(value: unknown, guard: Guard): boolean {
  return isRecord(value) && guard(value.vi) && guard(value.en)
}

function shapeGuard(fields: Readonly<Record<string, Guard>>): Guard {
  return (value) =>
    isRecord(value) && Object.entries(fields).every(([key, guard]) => guard(value[key]))
}

function arrayGuard(guard: Guard): Guard {
  return (value) => Array.isArray(value) && value.every(guard)
}

function choiceGuard(allowed: ReadonlySet<unknown>): Guard {
  return (value) => allowed.has(value)
}

function optionalGuard(guard: Guard): Guard {
  return (value) => value === undefined || guard(value)
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
