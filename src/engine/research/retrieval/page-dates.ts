import { parseIsoDay } from '@/core/utils/time'

// Structured signals live in the head of a document; reading past this only gives a hostile page
// more to scan.
const MAX_SCANNED_MARKUP_CHARS = 262_144

// Structured signals only — JSON-LD datePublished, published-time metas, a dated <time> tag — never
// free text: a candidate either parses to a calendar day or there is no date. Ordered most
// authoritative first; the first parseable candidate wins. A tag is found first and its attributes
// read second: `[^<>]` keeps each scan inside one tag, so the whole pass stays linear.
const SCRIPT_TAG_RE = /<script\b[^<>]*>/gi
const SCRIPT_CLOSE_RE = /<\/script>/gi
const JSON_LD_TYPE_RE = /\btype\s*=\s*["']application\/ld\+json["']/i
const JSON_LD_DATE_RE = /"datePublished"\s*:\s*"([^"]+)"/
const META_TAG_RE = /<meta\b[^<>]*>/gi
const META_KEY_RE =
  /\b(?:property|name)\s*=\s*["'](?:article:published_time|datePublished|date)["']/i
const META_CONTENT_RE = /\bcontent\s*=\s*["']([^"']+)["']/i
const TIME_TAG_RE = /<time\b[^<>]*>/gi
const TIME_DATETIME_RE = /\bdatetime\s*=\s*["']([^"']+)["']/i
const ISO_DAY_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/

/** The page's own published day from its structured markup, or nothing. */
export function extractPublishedDay(markup: string): string | undefined {
  for (const candidate of dateCandidates(markup.slice(0, MAX_SCANNED_MARKUP_CHARS))) {
    const day = toIsoDay(candidate)
    if (day !== undefined) {
      return day
    }
  }
  return undefined
}

function* dateCandidates(markup: string): Generator<string> {
  yield* jsonLdDates(markup)

  for (const tag of markup.matchAll(META_TAG_RE)) {
    const content = META_KEY_RE.test(tag[0]) ? META_CONTENT_RE.exec(tag[0])?.[1] : undefined
    if (content !== undefined) {
      yield content
      break
    }
  }

  for (const tag of markup.matchAll(TIME_TAG_RE)) {
    const time = TIME_DATETIME_RE.exec(tag[0])?.[1]
    if (time !== undefined) {
      yield time
      break
    }
  }
}

// A script with no closing tag ends the scan: no later one can close either.
function* jsonLdDates(markup: string): Generator<string> {
  let cursor = 0

  for (const tag of markup.matchAll(SCRIPT_TAG_RE)) {
    const bodyStart = tag.index + tag[0].length

    if (tag.index < cursor || !JSON_LD_TYPE_RE.test(tag[0])) {
      continue
    }

    SCRIPT_CLOSE_RE.lastIndex = bodyStart
    const close = SCRIPT_CLOSE_RE.exec(markup)
    if (close === null) {
      return
    }

    cursor = close.index + close[0].length
    const date = JSON_LD_DATE_RE.exec(markup.slice(bodyStart, close.index))?.[1]
    if (date !== undefined) {
      yield date
    }
  }
}

// Datetime values keep their day prefix; the round-trip through parseIsoDay rejects impossible days
// the pattern alone would pass.
function toIsoDay(value: string): string | undefined {
  const day = ISO_DAY_PREFIX_RE.exec(value.trim())?.[1]
  return day !== undefined && parseIsoDay(day) !== undefined ? day : undefined
}
