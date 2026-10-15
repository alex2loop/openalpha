#!/usr/bin/env bun
// Caveat-detail gate. A caveat's message declares placeholders (`{source}`, `{ticker}`) and its
// construction site supplies them through `detail`. No type connects the two, so a renamed key
// reaches the operator as a literal `{source}`.
//
// Only literals whose keys are exactly a subset of {code, detail} are read: a
// `{ kind: 'error', code }` source outcome carries the same codes but is not a caveat, and the
// boundary that turns one into a caveat is itself a checked site. A literal this cannot read is
// counted as skipped, so the pass line always says how much was proven.
import { Glob } from 'bun'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SOURCE_ROOT = 'src/trading'
const CATALOG_DIR = 'src/i18n/locales'
const LOCALES = ['en', 'vi'] as const
const CAVEAT_FIELDS: ReadonlySet<string> = new Set(['code', 'detail'])
const OPENERS: ReadonlySet<string> = new Set(['{', '(', '['])
const CLOSERS: ReadonlySet<string> = new Set(['}', ')', ']'])

const CODE_RE = /code:\s*'([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)'/g
const SOURCED_RE = /sourcedCaveat\(\s*'([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)'/g
const FIELD_NAME_RE = /^[A-Za-z_$][\w$]*$/
const PARAM_RE = /\{(\w+)\}/g
/** A placeholder the sentence stamps a unit onto. The formatter owns the unit, so a caveat carries
 *  the raw fraction and the catalog writes no `%` of its own — two writers of one unit is how the
 *  same weight came to print at two resolutions on two surfaces. */
const UNIT_SUFFIX_RE = /\{\w+\}%/
const MESSAGE_PREFIXES = ['caveat.', 'finding.'] as const

interface Site {
  readonly file: string
  readonly line: number
  readonly code: string
  readonly detail: ReadonlySet<string>
}

interface Failure {
  readonly site: Site
  readonly missing: readonly string[]
}

const catalogs = await Promise.all(LOCALES.map(readPlaceholders))
const scan = await scanSources([
  [CODE_RE, toObjectSite],
  [SOURCED_RE, toSourcedSite],
])
const failures = scan.sites.flatMap((site) => failure(site) ?? [])
const stamped = await Promise.all(LOCALES.map(unitStampedKeys))

if (failures.length > 0 || stamped.some((keys) => keys.length > 0)) {
  report(failures)
  reportUnitStamped(stamped)
  process.exit(1)
}

process.stdout.write(
  `check-caveat-details: PASS (${scan.sites.length} caveats, ${scan.skipped} skipped)\n`
)

/** Every caveat and finding message whose text writes the unit that belongs to the formatter. */
async function unitStampedKeys(locale: string): Promise<readonly string[]> {
  const raw: { readonly trading?: Readonly<Record<string, string>> } = await Bun.file(
    `${ROOT}/${CATALOG_DIR}/${locale}.json`
  ).json()

  return Object.entries(raw.trading ?? {})
    .filter(
      ([key, message]) =>
        MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) && UNIT_SUFFIX_RE.test(message)
    )
    .map(([key]) => `${locale}:${key}`)
}

function reportUnitStamped(stamped: readonly (readonly string[])[]): void {
  const keys = stamped.flat()

  if (keys.length === 0) {
    return
  }

  for (const key of keys) {
    process.stderr.write(`${key}: message writes '%' after a placeholder\n`)
  }

  process.stderr.write(
    `check-caveat-details: FAIL (${keys.length} message(s))\n` +
      '  rule: a caveat detail carries the raw fraction and SUBJECT_FRACTIONS renders its unit, so\n' +
      '  the catalog sentence never writes the `%` itself\n'
  )
}

function report(found: readonly Failure[]): void {
  if (found.length === 0) {
    return
  }

  for (const { site, missing } of found) {
    process.stderr.write(
      `${site.file}:${site.line}: '${site.code}' detail is missing ${missing.join(', ')}\n`
    )
  }

  process.stderr.write(
    `check-caveat-details: FAIL (${found.length} site(s))\n` +
      '  rule: a caveat supplies every placeholder its message declares, or carries a code whose\n' +
      '  message declares none\n'
  )
}

/** A key absent from a catalog belongs to check-trading-locale and the boot gate, so it contributes
 *  no requirement here. */
async function readPlaceholders(locale: string): Promise<ReadonlyMap<string, readonly string[]>> {
  const raw: { readonly trading?: Readonly<Record<string, string>> } = await Bun.file(
    `${ROOT}/${CATALOG_DIR}/${locale}.json`
  ).json()

  return new Map(
    Object.entries(raw.trading ?? {}).map(([key, message]) => [
      key,
      [...message.matchAll(PARAM_RE)].flatMap((match) => match[1] ?? []),
    ])
  )
}

type SiteReader = (file: string, text: string, at: number, code: string) => Site | undefined

interface Scan {
  readonly sites: readonly Site[]
  readonly skipped: number
}

async function scanSources(
  readers: readonly (readonly [RegExp, SiteReader])[]
): Promise<Scan> {
  const sites: Site[] = []
  const glob = new Glob('**/*.ts')
  let skipped = 0

  for await (const rel of glob.scan({ cwd: `${ROOT}/${SOURCE_ROOT}` })) {
    const file = `${SOURCE_ROOT}/${rel}`
    const text = await Bun.file(`${ROOT}/${file}`).text()

    for (const [pattern, read] of readers) {
      for (const match of text.matchAll(pattern)) {
        const site = read(file, text, match.index, match[1] ?? '')

        if (site === undefined) {
          skipped += 1
        } else {
          sites.push(site)
        }
      }
    }
  }

  return { sites, skipped }
}

/** `sourcedCaveat` supplies `source` itself, so only the caller's own params are required of it. */
function toSourcedSite(file: string, text: string, at: number, code: string): Site | undefined {
  const args = enclosedBody(text, text.indexOf('(', at), '(', ')')
  const detail = args === undefined ? undefined : detailKeys(splitTopLevel(args)[2]?.trim())

  return detail === undefined
    ? undefined
    : { file, line: lineOf(text, at), code, detail: new Set([...detail, 'source']) }
}

function toObjectSite(file: string, text: string, at: number, code: string): Site | undefined {
  const body = enclosingObjectBody(text, at)
  const fields = body === undefined ? undefined : topLevelFields(body)

  if (fields === undefined || ![...fields.keys()].every((key) => CAVEAT_FIELDS.has(key))) {
    return undefined
  }

  const detail = detailKeys(fields.get('detail'))

  return detail === undefined ? undefined : { file, line: lineOf(text, at), code, detail }
}

function lineOf(text: string, at: number): number {
  return text.slice(0, at).split('\n').length
}

/** Undefined when the value is present but not an object literal — an unreadable shape is skipped,
 *  never assumed complete. */
function detailKeys(value: string | undefined): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return new Set()
  }

  if (!value.startsWith('{') || !value.endsWith('}')) {
    return undefined
  }

  const fields = topLevelFields(value.slice(1, -1))

  return fields === undefined ? undefined : new Set(fields.keys())
}

/** The body of the object literal directly containing `at`, brace-balanced in both directions. */
function enclosingObjectBody(text: string, at: number): string | undefined {
  let depth = 0

  for (let index = at; index >= 0; index -= 1) {
    depth += text[index] === '}' ? 1 : text[index] === '{' ? -1 : 0

    if (depth < 0) {
      return enclosedBody(text, index, '{', '}')
    }
  }

  return undefined
}

/** The text between the delimiter at `open` and the one that closes it. */
function enclosedBody(
  text: string,
  open: number,
  opener: string,
  closer: string
): string | undefined {
  if (open < 0 || text[open] !== opener) {
    return undefined
  }

  let depth = 1

  for (let index = open + 1; index < text.length; index += 1) {
    depth += text[index] === opener ? 1 : text[index] === closer ? -1 : 0

    if (depth === 0) {
      return text.slice(open + 1, index)
    }
  }

  return undefined
}

/** `name: value` per depth-0 segment, plus bare `name` shorthand — a shorthand property supplies
 *  the key exactly as an explicit one does, and reading it as absent fails a complete caveat.
 *  Undefined when a segment spreads another object, whose keys this cannot see — treating that as
 *  complete would pass a caveat it never read. */
function topLevelFields(body: string): ReadonlyMap<string, string> | undefined {
  const fields = new Map<string, string>()

  for (const segment of splitTopLevel(body)) {
    const text = segment.trim()

    if (text.startsWith('...')) {
      return undefined
    }

    const colon = text.indexOf(':')
    const name = colon === -1 ? text : text.slice(0, colon).trim()

    if (FIELD_NAME_RE.test(name)) {
      fields.set(name, colon === -1 ? name : text.slice(colon + 1).trim())
    }
  }

  return fields
}

function splitTopLevel(body: string): readonly string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (const [index, char] of [...body].entries()) {
    depth += OPENERS.has(char) ? 1 : CLOSERS.has(char) ? -1 : 0

    if (depth === 0 && char === ',') {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }

  parts.push(body.slice(start))

  return parts
}

function failure(site: Site): Failure | undefined {
  const required = new Set(catalogs.flatMap((catalog) => catalog.get(`caveat.${site.code}`) ?? []))
  const missing = [...required].filter((param) => !site.detail.has(param))

  return missing.length === 0 ? undefined : { site, missing }
}
