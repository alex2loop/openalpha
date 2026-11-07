#!/usr/bin/env bun
// Public-brief gate. The public brief is built from reads that hold no book, and this holds the
// code that way: nothing under `features/brief/public/` reaches the operator's book by a value
// import, `briefServices` stays with its four holders, only `market`-scoped section kinds are
// published, no read asks which markets the operator uses, and the composition file and the screen
// it calls reach nothing of the operator's but one bit: whether the US segment is on. US stocks are
// a public market only while it is, and every public read of the US board is `followedBlind` and
// the board honours it. The walk follows value imports only; a type import erases.
// A violation is printed under the letter of the check that found it:
//   (a) a value import from `public/` reaches the book, or an exception no longer applies
//   (b) a file names `briefServices` and is no holder
//   (c) the section kinds and their scope record disagree, or a kind is written outside `scope.ts`
//   (d) a file names `marketsInUse`
//   (e) the composition file or the screen reaches more than the US segment bit
//   (f) a public read of the US board can see the operator's followed names
import { Glob } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_SCOPE } from '@/trading/kernel/operator/brief-section-scope'
import {
  PUBLIC_ANALYSIS_KINDS,
  PUBLIC_CORE_SECTIONS,
  PUBLIC_HEADLINE_KINDS,
  PUBLIC_SESSION_KIND,
  publicSectionKinds,
} from '@/trading/features/brief/public/scope'

import {
  BOOK_FREE_SCREEN_FILE,
  COMPOSITION_FILE,
  followedBlindGaps,
  MARKETS_DIR,
  segmentBitGaps,
  venueBlindGaps,
} from './check-public-brief-markets'
import { lineAt, scanImports } from './import-scan'

const REPO = resolve(import.meta.dir, '..')
const SRC = `${REPO}/src`
const TRADING = `${SRC}/trading`
const PUBLIC_DIR = `${TRADING}/features/brief/public`
const ALIAS_PREFIX = '@/'
const SOURCE_SUFFIXES = ['.ts', '/index.ts'] as const
const SCOPE_FILE = `${PUBLIC_DIR}/scope.ts`
const SCREEN_EVIDENCE_FILE = `${TRADING}/features/market-data/render/screen-evidence.ts`
const MARKETS_IN_USE_RE = /\bmarketsInUse\b/
const BRIEF_SERVICES_RE = /\bbriefServices\b/

/** The kinds scoped `book` today. The guard exempts every `market` kind's rows, so a book kind
 *  moved to `market` would also widen the guard: the move takes this list and the scope record,
 *  and a record that differs from the list in either direction fails. */
const BOOK_KINDS: readonly string[] = Object.freeze([
  'book-summary',
  'resolved-suggestions',
  'fired-alerts',
  'position-exits',
  'unwatched-positions',
  'stale-positions',
  'positions-in-loss',
  'cross-asset-pulse',
  'trade-sides',
  'drift-nudge',
  'monthly-scorecard',
  'deposit-rate',
  'watchlist-leading',
  'watchlist-dropped',
  'cost',
  'suggestions',
  'cross-asset-suggestions',
  'next-actions',
  'discipline',
])

/** Reached from `public/`, any of these is the operator's book or the code that reads it. Paths
 *  are under `src/trading/`, without extension: a prefix matches the file or the folder. */
const PUBLIC_BRIEF_FORBIDDEN: readonly string[] = [
  'features/portfolio',
  'features/ledger',
  'features/suggestion',
  'features/alerts',
  'features/order',
  'features/profile',
  'venues',
  'wiring',
  'features/brief/store',
  'features/brief/build',
  'features/brief/delivery',
  'features/brief/brief',
  'features/brief/command',
]

/** A forbidden folder's one file that holds no book: the seeded default profile. */
const PUBLIC_BRIEF_PERMITTED: readonly string[] = ['features/profile/policy']

/** Forbidden edges the walk lets through, and keeps walking past. It only shrinks, and a stale
 *  entry fails, so no edge survives quietly. */
const PUBLIC_BRIEF_EXCEPTIONS: readonly { readonly edge: string; readonly reason: string }[] = [
  {
    edge: 'src/trading/markets/brief-sections.ts -> src/trading/features/suggestion/types.ts',
    reason:
      '`isInconclusive` is a pure predicate on a suggestion value; it reads no store, and the ' +
      'public reads hand it none',
  },
]

/** The files in `markets/` that name `briefServices`: `deps.ts` declares the seam and the alias
 *  that drops it, `held-tickers.ts` is the one reader of the held and watched names through it, and
 *  each market that composes a brief splits it off before handing its builders `BriefDeps`. */
const BRIEF_SERVICES_HOLDERS: ReadonlySet<string> = new Set([
  `${MARKETS_DIR}/deps.ts`,
  `${MARKETS_DIR}/held-tickers.ts`,
  `${MARKETS_DIR}/equity-us/capabilities.ts`,
  `${MARKETS_DIR}/equity-vn/capabilities.ts`,
])

/** The places a public read of a market is made: the brief request, the overview read and the
 *  screen. Each states `followedBlind: true`. */
const FOLLOWED_BLIND_SETTERS: readonly string[] = [
  `${PUBLIC_DIR}/build.ts`,
  `${PUBLIC_DIR}/reads.ts`,
  BOOK_FREE_SCREEN_FILE,
]

/** What the screen the public brief calls may never reach, nor the file that renders its rows. */
const SCREEN_FORBIDDEN: readonly string[] = [
  'features/market-data/ops/exclusions',
  'features/market-data/ops/margin',
  'features/profile/store',
  'features/portfolio',
  'features/ledger',
  'venues',
  'wiring',
]

/** What the composition file may value-import from `src/trading/`. */
const COMPOSITION_ALLOWED: readonly string[] = [
  'features/brief/public/',
  'features/market-data/ops/book-free-screen',
  'features/market-data/render/screen-evidence',
  'features/profile/policy',
  'kernel/',
  'render/',
]

interface WalkOptions {
  readonly roots: readonly string[]
  readonly forbidden: readonly string[]
  readonly permitted: readonly string[]
  readonly exceptions: ReadonlyMap<string, string>
}

interface Walked {
  readonly offences: readonly string[]
  readonly usedEdges: ReadonlySet<string>
}

const publicFiles = [...new Glob('**/*.ts').scanSync(PUBLIC_DIR)].map(
  (file) => `${PUBLIC_DIR}/${file}`
)

const walked = walkValueImports({
  roots: publicFiles,
  forbidden: PUBLIC_BRIEF_FORBIDDEN,
  permitted: PUBLIC_BRIEF_PERMITTED,
  exceptions: exceptionEdges(),
})

const violations = [
  ...tagged('a', walked.offences),
  ...tagged(
    'a',
    staleExceptions(walked.usedEdges).map((edge) => `stale exception, no longer reached: ${edge}`)
  ),
  ...tagged(
    'b',
    briefServicesOutsideHolders().map((file) => `${file} names briefServices and is no holder`)
  ),
  ...tagged('c', unscopedKinds()),
  ...tagged('c', bookKindDrift()),
  ...tagged('c', kindLiteralsOutsideScope()),
  ...tagged('d', marketsInUseCallers().map((file) => `${file} names marketsInUse`)),
  ...tagged('e', compositionImports()),
  ...tagged('e', screenReaches()),
  ...tagged('e', venueBlindGaps()),
  ...tagged('e', segmentBitGaps()),
  ...tagged('f', followedBlindGaps(FOLLOWED_BLIND_SETTERS)),
]

if (violations.length > 0) {
  const lines = violations.map((line) => `  ${line}`).join('\n')

  process.stderr.write(`FAIL: ${violations.length} public-brief violation(s):\n${lines}\n`)
  process.exit(1)
}

process.stdout.write('check-public-brief: PASS\n')

function tagged(check: string, messages: readonly string[]): readonly string[] {
  return messages.map((message) => `(${check}) ${message}`)
}

function exceptionEdges(): ReadonlyMap<string, string> {
  return new Map(PUBLIC_BRIEF_EXCEPTIONS.map(({ edge, reason }) => [edge, reason]))
}

function staleExceptions(used: ReadonlySet<string>): readonly string[] {
  return PUBLIC_BRIEF_EXCEPTIONS.map(({ edge }) => edge).filter((edge) => !used.has(edge))
}

/** Breadth-first over value imports under `src/trading/`, naming the chain of every forbidden edge
 *  it meets. An excepted edge is let through and walked on; any other forbidden target is reported
 *  and not entered, so one leak is one line. */
function walkValueImports({ roots, forbidden, permitted, exceptions }: WalkOptions): Walked {
  const parent = new Map<string, string | undefined>(roots.map((root) => [root, undefined]))
  const queue = [...roots]
  const offences: string[] = []
  const usedEdges = new Set<string>()

  for (const file of queue) {
    for (const target of valueTargets(file)) {
      const edge = `${relative(REPO, file)} -> ${relative(REPO, target)}`

      if (isForbidden(target, forbidden, permitted) && !exceptions.has(edge)) {
        offences.push(`${edge} (${chainOf(parent, file)})`)

        continue
      }

      if (exceptions.has(edge)) {
        usedEdges.add(edge)
      }

      if (!parent.has(target)) {
        parent.set(target, file)
        queue.push(target)
      }
    }
  }

  return { offences, usedEdges }
}

function chainOf(parent: ReadonlyMap<string, string | undefined>, file: string): string {
  const chain: string[] = []

  for (let at: string | undefined = file; at !== undefined; at = parent.get(at)) {
    chain.unshift(relative(TRADING, at))
  }

  return `via ${chain.join(' -> ')}`
}

function valueTargets(file: string): readonly string[] {
  const targets: string[] = []

  for (const found of scanImports(readFileSync(file, 'utf8'))) {
    if (found.isTypeOnly) {
      continue
    }

    const target = resolveSource(file, found.specifier)

    if (target !== undefined && target.startsWith(`${TRADING}/`)) {
      targets.push(target)
    }
  }

  return targets
}

function resolveSource(importer: string, specifier: string): string | undefined {
  let base: string

  if (specifier.startsWith(ALIAS_PREFIX)) {
    base = `${SRC}/${specifier.slice(ALIAS_PREFIX.length)}`
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(importer), specifier)
  } else {
    return undefined
  }

  return SOURCE_SUFFIXES.map((suffix) => `${base}${suffix}`).find((candidate) =>
    existsSync(candidate)
  )
}

function isForbidden(
  target: string,
  forbidden: readonly string[],
  permitted: readonly string[]
): boolean {
  const path = relative(TRADING, target).replace(/\.ts$/, '')

  if (permitted.some((prefix) => isUnder(path, prefix))) {
    return false
  }

  return forbidden.some((prefix) => isUnder(path, prefix))
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
}

function briefServicesOutsideHolders(): readonly string[] {
  return [...new Glob('**/*.ts').scanSync(MARKETS_DIR)]
    .map((file) => `${MARKETS_DIR}/${file}`)
    .filter(
      (file) =>
        !BRIEF_SERVICES_HOLDERS.has(file) && BRIEF_SERVICES_RE.test(readFileSync(file, 'utf8'))
    )
    .map((file) => relative(REPO, file))
}

/** A kind the public brief names, or publishes under any toggle, that is not `market`-scoped. */
function unscopedKinds(): readonly string[] {
  const named = [
    ...PUBLIC_ANALYSIS_KINDS,
    ...PUBLIC_HEADLINE_KINDS,
    ...PUBLIC_CORE_SECTIONS,
    PUBLIC_SESSION_KIND,
  ].filter((kind) => BRIEF_SECTION_SCOPE[kind] !== 'market')
  const messages = named.map(
    (kind) => `${kind} is named by scope.ts and is scoped ${BRIEF_SECTION_SCOPE[kind]}`
  )

  for (const analysis of [true, false]) {
    for (const headlines of [true, false]) {
      for (const kind of publicSectionKinds({ analysis, headlines })) {
        if (BRIEF_SECTION_SCOPE[kind] !== 'market') {
          messages.push(
            `publicSectionKinds({ analysis: ${analysis}, headlines: ${headlines} }) returns ` +
              `${kind}, scoped ${BRIEF_SECTION_SCOPE[kind]}`
          )
        }
      }
    }
  }

  return messages
}

/** The scope record's `book` kinds against `BOOK_KINDS`, in both directions. */
function bookKindDrift(): readonly string[] {
  const listed: ReadonlySet<string> = new Set(BOOK_KINDS)
  const recorded: ReadonlySet<string> = new Set(
    BRIEF_SECTION_ORDER.filter((kind) => BRIEF_SECTION_SCOPE[kind] === 'book')
  )

  return [
    ...[...recorded]
      .filter((kind) => !listed.has(kind))
      .map((kind) => `${kind} is scoped book and is not in BOOK_KINDS`),
    ...BOOK_KINDS.filter((kind) => !recorded.has(kind)).map(
      (kind) => `${kind} is in BOOK_KINDS and is no longer scoped book`
    ),
  ]
}

/** Only `scope.ts` writes a section kind out; any other file under `public/` takes it from
 *  there. */
function kindLiteralsOutsideScope(): readonly string[] {
  const literal = new RegExp(`'(${BRIEF_SECTION_ORDER.join('|')})'`, 'g')
  const messages: string[] = []

  for (const file of publicFiles.filter((path) => path !== SCOPE_FILE)) {
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(literal)) {
      messages.push(
        `${relative(REPO, file)}:${lineAt(source, match.index)} writes the section kind ` +
          `${match[0]}; only scope.ts does`
      )
    }
  }

  return messages
}

function marketsInUseCallers(): readonly string[] {
  return [...publicFiles, COMPOSITION_FILE]
    .filter((file) => MARKETS_IN_USE_RE.test(readFileSync(file, 'utf8')))
    .map((file) => relative(REPO, file))
}

function compositionImports(): readonly string[] {
  const source = readFileSync(COMPOSITION_FILE, 'utf8')
  const messages: string[] = []

  for (const found of scanImports(source)) {
    const target = found.isTypeOnly ? undefined : resolveSource(COMPOSITION_FILE, found.specifier)

    if (target?.startsWith(`${TRADING}/`) !== true) {
      continue
    }

    const path = relative(TRADING, target).replace(/\.ts$/, '')

    if (!COMPOSITION_ALLOWED.some((prefix) => isUnder(path, prefix))) {
      messages.push(
        `${relative(REPO, COMPOSITION_FILE)}:${lineAt(source, found.index)} value-imports ${path}`
      )
    }
  }

  return messages
}

function screenReaches(): readonly string[] {
  return walkValueImports({
    roots: [BOOK_FREE_SCREEN_FILE, SCREEN_EVIDENCE_FILE],
    forbidden: SCREEN_FORBIDDEN,
    permitted: [],
    exceptions: new Map(),
  }).offences
}
