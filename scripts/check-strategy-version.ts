#!/usr/bin/env bun
// What a market suggests is decided by its level policy, its factor policy and the bounds they read,
// and `*_STRATEGY_VERSION` is what the track record groups by. Nothing else connects them, so a
// changed weight, multiplier or bound could ship under a version claiming the old population.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const RECORD_FILE = 'scripts/strategy-versions.json'
/** Every file whose policy literals decide what a market suggests. The first declares the version;
 *  `gold-vn` has none of its own and shares gold's, so its factors bump gold's. */
const POLICY_SOURCES: Readonly<Record<string, readonly string[]>> = {
  crypto: ['src/trading/markets/crypto/policy.ts'],
  'equity-vn': [
    'src/trading/markets/equity-vn/policy.ts',
    'src/trading/markets/equity-vn/factor-policy.ts',
    'src/trading/markets/equity-vn/factors/fundamental-components.ts',
  ],
  gold: ['src/trading/markets/gold/policy.ts', 'src/trading/markets/gold-vn/policy.ts'],
}
/** The policy literals, and the scalars and bounds they read from beside them: a normalization
 *  range, a cap or a threshold decides a score as surely as a weight does. */
const POLICY_PATTERN =
  'export const [A-Z_]*(?:(?:LEVEL|FACTOR|ACCOUNTS)_POLICY|_COMPONENTS|_RANGE|_CAP|_PCT|_FALLBACK)\\b[^=]*=\\s*'
const SCALAR_RE = /^-?[\d_.]+(?:e-?\d+)?/
const VERSION_RE = /export const [A-Z_]*STRATEGY_VERSION\s*=\s*'([^']+)'/
const OPENERS = '({'
const CLOSERS = ')}'
const DIGEST_LENGTH = 16
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
const WHITESPACE_RE = /\s+/g
const EXIT_DRIFTED = 1

interface Recorded {
  readonly version: string
  readonly digest: string
}

async function readMarket(files: readonly string[]): Promise<Recorded> {
  const texts = await Promise.all(files.map((file) => readFile(resolve(ROOT, file), 'utf8')))
  const version = VERSION_RE.exec(texts[0] ?? '')?.[1]
  const literals = texts.flatMap(policyLiterals)

  if (version === undefined) {
    throw new Error(`${files[0]}: no strategy version found`)
  }
  if (literals.length === 0) {
    throw new Error(`${files.join(', ')}: no policy found`)
  }

  return { version, digest: digestOf(literals.join('\n')) }
}

/** Every policy literal in one file, in source order. A fresh regex per call: a module-level global
 *  one carries `lastIndex` from the previous file and starts the next scan mid-way. */
function policyLiterals(text: string): readonly string[] {
  const scan = new RegExp(POLICY_PATTERN, 'g')
  const found: string[] = []

  for (let match = scan.exec(text); match !== null; match = scan.exec(text)) {
    found.push(literalFrom(text, match.index + match[0].length))
  }

  return found
}

/** A bare number as written, and anything else from its first bracket to the one that closes it. */
function literalFrom(text: string, at: number): string {
  return SCALAR_RE.exec(text.slice(at))?.[0] ?? balancedFrom(text, at)
}

/** The literal as written, from its first bracket to the one that closes it. The scan starts at the
 *  bracket rather than at the assignment, because every policy is wrapped in `Object.freeze(...)`
 *  and a scan that begins on a letter sees depth 0 and stops on the second character. */
function balancedFrom(text: string, at: number): string {
  const opened = indexOfOpener(text, at)
  let depth = 0

  for (let index = opened; index < text.length; index += 1) {
    const char = text[index] ?? ''

    depth += OPENERS.includes(char) ? 1 : 0
    depth -= CLOSERS.includes(char) ? 1 : 0

    if (depth === 0) {
      return text.slice(opened, index + 1)
    }
  }

  throw new Error('unbalanced policy literal')
}

function indexOfOpener(text: string, at: number): number {
  for (let index = at; index < text.length; index += 1) {
    if (OPENERS.includes(text[index] ?? '')) {
      return index
    }
  }

  throw new Error('policy literal opens no bracket')
}

/** Comments and layout are not policy, so neither moves the digest. */
function digestOf(literal: string): string {
  return createHash('sha256')
    .update(literal.replace(COMMENT_RE, '').replace(WHITESPACE_RE, ' ').trim())
    .digest('hex')
    .slice(0, DIGEST_LENGTH)
}

const actual: Record<string, Recorded> = {}

for (const [market, files] of Object.entries(POLICY_SOURCES)) {
  actual[market] = await readMarket(files)
}

if (process.argv.includes('--write')) {
  await writeFile(resolve(ROOT, RECORD_FILE), `${JSON.stringify(actual, null, 2)}\n`)
  console.log(`check-strategy-version: recorded ${Object.keys(actual).length} market(s)`)
  process.exit(0)
}

const recorded: Record<string, Recorded> = JSON.parse(
  await readFile(resolve(ROOT, RECORD_FILE), 'utf8')
)
const drifted = Object.entries(actual).filter(
  ([market, entry]) =>
    recorded[market]?.digest !== entry.digest || recorded[market]?.version !== entry.version
)

if (drifted.length > 0) {
  for (const [market, entry] of drifted) {
    console.error(
      `${market}: policy digest ${entry.digest} version ${entry.version}, recorded ` +
        `${recorded[market]?.digest ?? 'none'} version ${recorded[market]?.version ?? 'none'}`
    )
  }
  console.error(
    "A level or factor policy changed. Bump that market's *_STRATEGY_VERSION, then re-record " +
      'with bun scripts/check-strategy-version.ts --write'
  )
  process.exit(EXIT_DRIFTED)
}

console.log(`check-strategy-version: PASS (${Object.keys(actual).length} markets)`)
