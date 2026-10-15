#!/usr/bin/env bun
// Display-contract gate. The trading surface prints one set of units, formatters and glyphs, and
// most of that contract is only enforceable by reading the call sites: a day interpolated raw, a
// score printed as money, a count that skipped `Intl`, an indent typed by hand, or one glyph
// standing for two different concepts all type-check perfectly.
//
// Call sites are matched by shape (a `t(...)` call and the top-level properties of its params
// object), so prose and nested calls are not mistaken for the property they sit under.
//
// Exit 0 = clean. Failures print every offending site and exit 1.
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const TRADING = 'src/trading'
const RENDER = `${TRADING}/render`

// The layout kernel owns indentation and the provenance clock; it is the one file allowed to build
// what every other file must ask it for.
const LAYOUT_FILE = 'layout.ts'

const DAY_PROPS: ReadonlySet<string> = new Set([
  'day',
  'date',
  'at',
  'asOf',
  'exitDay',
  'sellableFrom',
  'dataThroughDay',
])
const DAY_FORMATTER_RE = /^(?:formatTradingDay|formatDay)\(/

// A score is a position on a scale, not an amount of money. Printing one through a money formatter
// gives it a currency it does not have.
const SCORE_PROPS: ReadonlySet<string> = new Set([
  'score',
  'contribution',
  'signal',
  'agreement',
  'coverage',
  'threshold',
])
const MONEY_FORMATTER_RE = /^(?:formatAmount|formatFlow|formatRatio)\(/

// A price is board-scaled where its market says so, which only `formatPrice` knows.
const PRICE_PROPS: ReadonlySet<string> = new Set([
  'price',
  'entry',
  'stop',
  'target',
  'last',
  'support',
  'resistance',
  'buyPrice',
  'sellPrice',
  'unitCost',
])
const PRICE_BANNED_RE = /^(?:formatAmount|formatMoney)\(/

// Counts group their digits by the reader's locale like every other number on the line.
const COUNT_NAMES: ReadonlySet<string> = new Set([
  'count',
  'universeSize',
  'sessions',
  'hits',
  'n',
  'wins',
  'losses',
])
const BARE_VALUE_RE = /^[A-Za-z_$][\w$.]*$/

const INDENT_LITERAL_RE = /^ {2,}$/
// Runs of spaces that are not indentation. Each entry says what it separates; a constant that turns
// out to be an indent is replaced by `INDENT`, never added here.
const SPACING_CONSTANTS: ReadonlyMap<string, string> = new Map([
  ['COLUMN_GAP', 'separates padded cells inside a table row, after the row is already indented'],
])

// One glyph, one concept - except where a section header and the tool that fills it are the same
// concept seen twice. Each entry says which pair; a glyph that names two different things is
// changed, never added here.
const SHARED_GLYPHS: ReadonlyMap<string, string> = new Map([
  ['⚖️', 'the advice section and the rebalance tool that produces it'],
  ['🌅', 'the brief section and the brief tool'],
  ['🌐', 'the macro section and the macro-risk tool'],
  ['👀', 'the watchlist section and the watchlist tool'],
  ['🔭', 'the themes section and the themes_view tool'],
  ['💡', 'the suggestion section and the two tools that produce one'],
  ['💵', 'the quote section and the price tool'],
  ['📅', 'the upcoming-events section and the corporate-events tool'],
  ['📈', 'the reflect section and the track-record tool'],
  ['📊', 'the portfolio section and the portfolio tool'],
  ['🪪', 'the profile section and the profile-view tool'],
  ['🔔', 'the alert section and the alert tool'],
  ['🔬', 'the screen section and the screen tool'],
  ['🛒', 'the order section and the order-place tool'],
  ['🗺️', 'the overview section and the overview tool'],
  ['🧾', 'the ledger section and the portfolio-history tool'],
])

// Asked of Unicode rather than tabulated, so a glyph nobody thought to list still resolves. Three
// cases, not two: `Emoji_Presentation` already renders as emoji and the extra code point is a cell
// one terminal counts and another does not; `Emoji` without it defaults to text and needs U+FE0F;
// a box-drawing or math symbol is neither, and a selector on one means nothing.
const EMOJI_DEFAULT_RE = /\p{Emoji_Presentation}/u
const TEXT_DEFAULT_EMOJI_RE = /^(?!\p{Emoji_Presentation})\p{Emoji}$/u
const VS16 = '️'
const SHORT_LITERAL_RE = /'([^'\\\n]{1,4})'/g
const EMOJI_RE = /[\u{2190}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1FAFF}]/u

interface Property {
  readonly name: string
  readonly value: string
  readonly line: number
}

const failures: string[] = []

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length

// Body of the object literal that follows `from`, or undefined when the call has no params object.
function paramsBody(source: string, from: number): string | undefined {
  const open = source.indexOf('{', from)

  if (open === -1 || !/^[\s,]*$/.test(source.slice(from, open))) {
    return undefined
  }

  let depth = 0
  let quote = ''

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i] ?? ''

    if (quote !== '') {
      if (ch === '\\') {
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1
      if (depth === 0) {
        return source.slice(open + 1, i)
      }
    }
  }

  return undefined
}

// Top-level `name: expression` pairs of an object body, split on depth-0 commas so a nested call's
// own arguments stay part of the value they belong to.
function topLevelProperties(body: string, startLine: number): readonly Property[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quote = ''

  for (const ch of body) {
    if (quote !== '') {
      current += ch
      if (ch === quote) {
        quote = ''
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1
    }

    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  parts.push(current)

  const out: Property[] = []
  let line = startLine

  for (const part of parts) {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*:([\s\S]*)$/.exec(part)

    if (match?.[1] !== undefined && match[2] !== undefined) {
      out.push({ name: match[1], value: match[2].trim(), line })
    }

    line += part.split('\n').length - 1
  }

  return out
}

function checkProperty(file: string, property: Property): void {
  const { name, value, line } = property
  const at = `${file}:${line}`
  const tail = value.split('.').at(-1) ?? value

  if (DAY_PROPS.has(name) && !DAY_FORMATTER_RE.test(value)) {
    failures.push(`${at} '${name}' interpolates a raw day - use formatTradingDay/formatDay`)
  }

  if (SCORE_PROPS.has(name) && MONEY_FORMATTER_RE.test(value)) {
    failures.push(`${at} '${name}' is a score printed through a money formatter`)
  }

  if (PRICE_PROPS.has(name) && PRICE_BANNED_RE.test(value)) {
    failures.push(`${at} '${name}' is a price - use formatPrice so the board scale applies`)
  }

  if (BARE_VALUE_RE.test(value) && (COUNT_NAMES.has(tail) || tail.endsWith('Count'))) {
    failures.push(`${at} '${name}' interpolates a raw count - wrap it in formatCount`)
  }
}

// Params reach `t` two ways: inline, and assembled into a local that two keys then share.
const PARAMS_RE = /\bt\(\s*[A-Za-z_$][\w$.]*\s*,\s*(?:'[^']*'|`[^`]*`)|\bconst\s+[A-Za-z_$][\w$]*(?::[^=\n]+)?\s*=/g

function checkCallSites(file: string, source: string): void {
  for (const match of source.matchAll(PARAMS_RE)) {
    const body = paramsBody(source, match.index + match[0].length)

    if (body !== undefined) {
      for (const property of topLevelProperties(body, lineAt(source, match.index))) {
        checkProperty(file, property)
      }
    }
  }
}

function checkIndents(file: string, source: string): void {
  for (const match of source.matchAll(SHORT_LITERAL_RE)) {
    const literal = match[1]

    if (literal === undefined || !INDENT_LITERAL_RE.test(literal)) {
      continue
    }

    const declared = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*$/.exec(source.slice(0, match.index))?.[1]

    if (declared === undefined || !SPACING_CONSTANTS.has(declared)) {
      failures.push(
        `${file}:${lineAt(source, match.index)} hand-typed indent - use INDENT from render/layout`
      )
    }
  }
}

function checkImports(file: string, source: string): void {
  if (/\bformatUsd\b/.test(source)) {
    failures.push(`${file} uses formatUsd - the surface formats currency for the reader's locale`)
  }
}

// Every glyph the surface shows: section headers, the per-row marks, tool presentation, and market
// manifests. A mark map is read by the same rule as a header map — a glyph that names one concept
// as a header and another as a row mark is the confusion this gate exists to catch.
function collectGlyphs(file: string, source: string, into: Map<string, string[]>): void {
  const blocks = source.matchAll(
    /(SECTION_ICONS|\w+_MARKS) = Object\.freeze\(\{([\s\S]*?)\}(?: satisfies [^)]*)?\)/g
  )

  for (const block of blocks) {
    for (const entry of (block[2] ?? '').matchAll(/(\w+): '([^']+)'/g)) {
      push(into, entry[2], `${block[1]}.${entry[1]}`)
    }
  }

  for (const entry of source.matchAll(/\b(?:emoji|icon): '([^']+)'/g)) {
    push(into, entry[1], `${file}:${lineAt(source, entry.index)}`)
  }
}

function push(into: Map<string, string[]>, glyph: string | undefined, site: string): void {
  if (glyph !== undefined) {
    into.set(glyph, [...(into.get(glyph) ?? []), site])
  }
}

function checkGlyphs(glyphs: ReadonlyMap<string, readonly string[]>): void {
  for (const [glyph, sites] of [...glyphs].sort(([a], [b]) => a.localeCompare(b))) {
    if (sites.length > 1 && !SHARED_GLYPHS.has(glyph)) {
      failures.push(
        `'${glyph}' names ${sites.length} concepts (${sites.join(', ')}) - change one, or add ` +
          `it to SHARED_GLYPHS with the pair it covers`
      )
    }

    checkSelector(glyph)
  }

  for (const glyph of SHARED_GLYPHS.keys()) {
    if ((glyphs.get(glyph)?.length ?? 0) < 2) {
      failures.push(`'${glyph}' no longer has 2+ sites - drop it from SHARED_GLYPHS`)
    }
  }
}

function checkSelector(glyph: string): void {
  const base = glyph.replace(VS16, '')
  const carries = glyph.includes(VS16)
  const wants = TEXT_DEFAULT_EMOJI_RE.test(base)

  if (wants === carries || !(wants || EMOJI_DEFAULT_RE.test(base))) {
    return
  }

  const point = base.codePointAt(0)?.toString(16).toUpperCase() ?? '?'

  failures.push(
    `'${glyph}' (U+${point}) ${carries ? 'carries' : 'is missing'} U+FE0F - it defaults to ` +
      `${wants ? 'text' : 'emoji'} presentation`
  )
}

async function checkCatalogs(): Promise<void> {
  for (const locale of ['en', 'vi']) {
    const file = `src/i18n/locales/${locale}.json`
    const catalog: Record<string, Record<string, string>> = await Bun.file(
      resolve(ROOT, file)
    ).json()

    for (const [key, value] of Object.entries(catalog.trading ?? {})) {
      if (typeof value === 'string' && EMOJI_RE.test(value)) {
        failures.push(`${file} '${key}' carries a glyph - glyphs live in code, which owns them`)
      }
    }
  }
}

const glyphs = new Map<string, string[]>()
let scanned = 0

for await (const rel of new Bun.Glob('**/*.ts').scan({ cwd: resolve(ROOT, TRADING) })) {
  const file = `${TRADING}/${rel}`
  const source = await Bun.file(resolve(ROOT, TRADING, rel)).text()

  scanned += 1
  collectGlyphs(file, source, glyphs)

  if (!file.startsWith(RENDER)) {
    continue
  }

  checkImports(file, source)

  if (!rel.endsWith(LAYOUT_FILE)) {
    checkCallSites(file, source)
    checkIndents(file, source)
  }
}

checkGlyphs(glyphs)
await checkCatalogs()

if (failures.length > 0) {
  process.stderr.write(`FAIL: ${failures.length} display-contract violation(s):\n`)

  for (const failure of failures) {
    process.stderr.write(`  ${failure}\n`)
  }

  process.exit(1)
}

process.stdout.write(
  `check-display-contract: PASS (${scanned} files, ${glyphs.size} glyphs, ` +
    `${SHARED_GLYPHS.size} shared by allowance)\n`
)
