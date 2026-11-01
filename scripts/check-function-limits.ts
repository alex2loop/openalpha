#!/usr/bin/env bun
// Function-size gate: a top-level function body over MAX_FUNCTION_LINES code lines is a violation
// unless it is listed in known-long-functions.json at its measured size. The list only shrinks: a
// listed function may not grow, one that shrinks must lower its number, and one that drops to the
// limit must leave the list.
//
// Biome's `noExcessiveLinesPerFunction` stops counting correctly after a blank line followed by a
// comment, so long functions pass it; this counter relies on the formatter instead. Biome puts a
// top-level declaration at column 0 and its closing brace at column 0, which a brace counter
// cannot assume but a line scanner can.
//
// A body counts the lines that are not blank, not `//` lines and not inside `/* ... */`. Nested
// functions count toward the outer one, as Biome counts them. Methods, and arrow functions whose
// head does not end its line with `=> {`, are not measured.
//
// `--update` rewrites the list from the current measurement: use it once to seed, and after
// splitting a function, so the diff shows in review.
//
// Exit 0 = clean. Exit 1 if a function is over the limit and unlisted, listed at a size it no longer
// has, or listed and no longer over the limit.
import { Glob } from 'bun'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const LIST_PATH = `${ROOT}/scripts/known-long-functions.json`
const SRC_ROOT = 'src'
const MAX_FUNCTION_LINES = 40
const LIST_NOTE =
  'Measured body code lines; ratchet only. Split a function rather than raise a number here.'
const FUNCTION_HEAD_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/
const ARROW_HEAD_RE = /^(?:export\s+)?const\s+(\w+)\b.*=>\s*\{$/
const SIGNATURE_OPEN_ENDINGS = ['(', ',', '<']
const RETURN_TYPE_OBJECT_ENDINGS = [': {', '<{']
const SIGNATURE_CLOSE_STARTS = [')', '}', '>']
const INDENTED_RE = /^\s/

interface KnownList {
  readonly note: string
  readonly functions: Readonly<Record<string, number>>
}

interface Violation {
  readonly key: string
  readonly message: string
}

type Measured = Map<string, number>

async function main(): Promise<void> {
  const measured = await measureAll()
  const wantsUpdate = process.argv.includes('--update')

  if (wantsUpdate) {
    await writeList(measured)
    console.log(`check-function-limits: wrote ${overLimit(measured).size} function(s)`)

    return
  }

  const known = await readList()
  const violations = [...unlisted(measured, known), ...changed(measured, known)]

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`  ${violation.key}: ${violation.message}`)
    }

    console.error(`FAIL: ${violations.length} function-size violation(s).`)
    process.exit(1)
  }

  const listed = Object.keys(known.functions).length

  console.log(`check-function-limits: PASS (${listed} listed, 0 new over ${MAX_FUNCTION_LINES})`)
}

async function measureAll(): Promise<Measured> {
  const measured: Measured = new Map()

  for await (const rel of new Glob('**/*.{ts,tsx}').scan({ cwd: `${ROOT}/${SRC_ROOT}` })) {
    const path = `${SRC_ROOT}/${rel}`
    const text = await Bun.file(`${ROOT}/${path}`).text()

    for (const [key, lines] of measureFile(path, text.split('\n'))) {
      measured.set(key, lines)
    }
  }

  return measured
}

function measureFile(path: string, lines: readonly string[]): Measured {
  const measured: Measured = new Map()
  const seen = new Map<string, number>()
  let i = 0

  while (i < lines.length) {
    const head = toHead(lines[i] ?? '')
    const bodyStart = head === undefined ? undefined : findBodyStart(lines, i)

    if (head === undefined || bodyStart === undefined) {
      i++
      continue
    }

    const end = findBodyEnd(lines, bodyStart)
    const count = (seen.get(head) ?? 0) + 1

    seen.set(head, count)
    measured.set(toKey(path, head, count), countCodeLines(lines.slice(bodyStart, end)))
    i = end + 1
  }

  return measured
}

function toKey(path: string, name: string, occurrence: number): string {
  return occurrence === 1 ? `${path}#${name}` : `${path}#${name}#${occurrence}`
}

function toHead(line: string): string | undefined {
  return FUNCTION_HEAD_RE.exec(line)?.[1] ?? ARROW_HEAD_RE.exec(line)?.[1]
}

/** The index of the first body line, or undefined for an overload or a one-line function. A head
 *  ending in `{` still continues when that brace opens a parameter or a return-type object. */
function findBodyStart(lines: readonly string[], head: number): number | undefined {
  const line = (lines[head] ?? '').trimEnd()

  if (!line.endsWith('{')) {
    return endsSignatureOpen(line) ? findSignatureClose(lines, head) : undefined
  }

  const continues = isHuggedParameter(line) || isReturnTypeObject(line)

  return continues ? findSignatureClose(lines, head) : head + 1
}

function isReturnTypeObject(line: string): boolean {
  return RETURN_TYPE_OBJECT_ENDINGS.some((ending) => line.endsWith(ending))
}

function endsSignatureOpen(line: string): boolean {
  return SIGNATURE_OPEN_ENDINGS.some((ending) => line.endsWith(ending))
}

function isHuggedParameter(line: string): boolean {
  return countChar(line, '(') > countChar(line, ')')
}

/** A signature that spans lines opens its body on the first column-0 closer that ends with `{`,
 *  unless that closer only opens a return-type object. Any other column-0 line ends the search: an
 *  overload has no body, and scanning on would pair its head with the next function's. */
function findSignatureClose(lines: readonly string[], head: number): number | undefined {
  for (let j = head + 1; j < lines.length; j++) {
    const line = (lines[j] ?? '').trimEnd()

    if (line === '' || INDENTED_RE.test(line)) {
      continue
    }

    if (!SIGNATURE_CLOSE_STARTS.some((start) => line.startsWith(start))) {
      return undefined
    }

    if (line.endsWith('{') && !isReturnTypeObject(line)) {
      return j + 1
    }
  }

  return undefined
}

function findBodyEnd(lines: readonly string[], bodyStart: number): number {
  for (let j = bodyStart; j < lines.length; j++) {
    if ((lines[j] ?? '').startsWith('}')) {
      return j
    }
  }

  return lines.length
}

function countCodeLines(body: readonly string[]): number {
  let count = 0
  let inBlock = false

  for (const raw of body) {
    const line = raw.trim()

    if (inBlock) {
      inBlock = !line.includes('*/')
      continue
    }

    if (line.startsWith('/*')) {
      inBlock = !line.includes('*/')
      continue
    }

    if (line !== '' && !line.startsWith('//')) {
      count++
    }
  }

  return count
}

function countChar(text: string, char: string): number {
  return text.split(char).length - 1
}

function overLimit(measured: Measured): Measured {
  return new Map([...measured].filter(([, lines]) => lines > MAX_FUNCTION_LINES))
}

function unlisted(measured: Measured, known: KnownList): readonly Violation[] {
  return [...overLimit(measured)]
    .filter(([key]) => known.functions[key] === undefined)
    .map(([key, lines]) => ({ key, message: `${lines} body lines, over ${MAX_FUNCTION_LINES}: split it` }))
}

function changed(measured: Measured, known: KnownList): readonly Violation[] {
  const violations: Violation[] = []

  for (const [key, listed] of Object.entries(known.functions)) {
    const lines = measured.get(key)

    if (lines === undefined || lines <= MAX_FUNCTION_LINES) {
      violations.push({ key, message: 'gone or within the limit: drop it from known-long-functions.json' })
    } else if (lines > listed) {
      violations.push({ key, message: `it grew from ${listed} to ${lines}: split it` })
    } else if (lines < listed) {
      violations.push({ key, message: `it shrank from ${listed} to ${lines}: lower its number` })
    }
  }

  return violations
}

async function readList(): Promise<KnownList> {
  const list: KnownList = await Bun.file(LIST_PATH).json()

  return list
}

async function writeList(measured: Measured): Promise<void> {
  const functions = Object.fromEntries(
    [...overLimit(measured)].sort(([a], [b]) => a.localeCompare(b, 'en'))
  )
  const list: KnownList = { note: LIST_NOTE, functions }

  await Bun.write(LIST_PATH, `${JSON.stringify(list, null, 2)}\n`)
}

await main()
