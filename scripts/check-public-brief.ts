#!/usr/bin/env bun
// Public-brief gate. The public brief is built from reads that hold no book, and this holds the code
// that way: nothing under `features/brief/public/` reaches the operator's book by a value import,
// `briefServices` stays with its four holders, only `market`-scoped section kinds are published, no
// read asks which markets the operator uses, and the composition file and the screen it calls reach
// nothing of the operator's. The walk follows value imports only; a type import erases.
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
import { PUBLIC_BRIEF_MARKETS } from '@/trading/features/brief/public/reads'

import { lineAt, scanImports } from './import-scan'

const REPO = resolve(import.meta.dir, '..')
const SRC = `${REPO}/src`
const TRADING = `${SRC}/trading`
const PUBLIC_DIR = `${TRADING}/features/brief/public`
const ALIAS_PREFIX = '@/'
const SOURCE_SUFFIXES = ['.ts', '/index.ts'] as const
const SCOPE_FILE = `${PUBLIC_DIR}/scope.ts`
const COMPOSITION_FILE = `${TRADING}/wiring/composition/public-brief.ts`
const BOOK_FREE_SCREEN_FILE = `${TRADING}/features/market-data/ops/book-free-screen.ts`
const SCREEN_EVIDENCE_FILE = `${TRADING}/features/market-data/render/screen-evidence.ts`
const CRYPTO_SCREEN_FILE = `${TRADING}/markets/crypto/screen-run.ts`
const MARKETS_DIR = `${TRADING}/markets`
const UNSCOPED_MARKET = 'equity-us'
const VENUE_BLIND_SET_RE = /\bvenueBlind:\s*true\b/
const VENUE_BLIND_READ_RE = /\bvenueBlind\b/
const MARKETS_IN_USE_RE = /\bmarketsInUse\b/
const BRIEF_SERVICES_RE = /\bbriefServices\b/

/** Reached from `public/`, any of these is the operator's book or the code that reads it. Paths are
 *  under `src/trading/`, without extension: a prefix matches the file or the folder. */
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

/** Forbidden edges the walk lets through, and keeps walking past. It only shrinks, and a stale entry
 *  fails, so no edge survives quietly. */
const PUBLIC_BRIEF_EXCEPTIONS: readonly { readonly edge: string; readonly reason: string }[] = [
  {
    edge: 'src/trading/markets/brief-sections.ts -> src/trading/features/suggestion/types.ts',
    reason:
      '`isInconclusive` is a pure predicate on a suggestion value; it reads no store, and the public reads hand it none',
  },
]

/** The files in `markets/` that name `briefServices`: `deps.ts` declares the seam and the alias that
 *  drops it, `held-tickers.ts` is the one reader of the held and watched names through it, and each
 *  market that composes a brief splits it off before handing its builders `BriefDeps`. */
const BRIEF_SERVICES_HOLDERS: ReadonlySet<string> = new Set([
  `${MARKETS_DIR}/deps.ts`,
  `${MARKETS_DIR}/held-tickers.ts`,
  `${MARKETS_DIR}/equity-us/capabilities.ts`,
  `${MARKETS_DIR}/equity-vn/capabilities.ts`,
])

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

interface Walked {
  readonly offences: readonly string[]
  readonly usedEdges: ReadonlySet<string>
}

const violations: string[] = []
const publicFiles = [...new Glob('**/*.ts').scanSync(PUBLIC_DIR)].map((file) => `${PUBLIC_DIR}/${file}`)

const walked = walkValueImports(publicFiles, PUBLIC_BRIEF_FORBIDDEN, PUBLIC_BRIEF_PERMITTED, exceptionEdges())

violations.push(...walked.offences.map((offence) => `(a) ${offence}`))
violations.push(...staleExceptions(walked.usedEdges).map((edge) => `(a) stale exception, no longer reached: ${edge}`))
violations.push(...briefServicesOutsideHolders().map((file) => `(b) ${file} names briefServices and is no holder`))
violations.push(...unscopedKinds().map((message) => `(c) ${message}`))
violations.push(...kindLiteralsOutsideScope().map((message) => `(c) ${message}`))
violations.push(...marketsInUseCallers().map((file) => `(d) ${file} names marketsInUse`))
violations.push(...compositionImports().map((message) => `(e) ${message}`))
violations.push(...screenReaches().map((offence) => `(e) ${offence}`))
violations.push(...venueBlindGaps().map((message) => `(e) ${message}`))
violations.push(...unscopedMarkets().map((market) => `(f) PUBLIC_BRIEF_MARKETS holds ${market}, whose board reads the operator's followed names`))

if (violations.length > 0) {
  process.stderr.write(`FAIL: ${violations.length} public-brief violation(s):\n${violations.map((line) => `  ${line}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('check-public-brief: PASS\n')

function exceptionEdges(): ReadonlyMap<string, string> {
  return new Map(PUBLIC_BRIEF_EXCEPTIONS.map(({ edge, reason }) => [edge, reason]))
}

function staleExceptions(used: ReadonlySet<string>): readonly string[] {
  return PUBLIC_BRIEF_EXCEPTIONS.map(({ edge }) => edge).filter((edge) => !used.has(edge))
}

/** Breadth-first over value imports under `src/trading/`, naming the chain of every forbidden edge
 *  it meets. An excepted edge is let through and walked on; any other forbidden target is reported
 *  and not entered, so one leak is one line. */
function walkValueImports(
  roots: readonly string[],
  forbidden: readonly string[],
  permitted: readonly string[],
  exceptions: ReadonlyMap<string, string>
): Walked {
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

  return SOURCE_SUFFIXES.map((suffix) => `${base}${suffix}`).find((candidate) => existsSync(candidate))
}

function isForbidden(target: string, forbidden: readonly string[], permitted: readonly string[]): boolean {
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
    .filter((file) => !BRIEF_SERVICES_HOLDERS.has(file) && BRIEF_SERVICES_RE.test(readFileSync(file, 'utf8')))
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
  const messages = named.map((kind) => `${kind} is named by scope.ts and is scoped ${BRIEF_SECTION_SCOPE[kind]}`)

  for (const analysis of [true, false]) {
    for (const headlines of [true, false]) {
      for (const kind of publicSectionKinds({ analysis, headlines })) {
        if (BRIEF_SECTION_SCOPE[kind] !== 'market') {
          messages.push(`publicSectionKinds({ analysis: ${analysis}, headlines: ${headlines} }) returns ${kind}, scoped ${BRIEF_SECTION_SCOPE[kind]}`)
        }
      }
    }
  }

  return messages
}

/** Only `scope.ts` writes a section kind out; any other file under `public/` takes it from there. */
function kindLiteralsOutsideScope(): readonly string[] {
  const literal = new RegExp(`'(${BRIEF_SECTION_ORDER.join('|')})'`, 'g')
  const messages: string[] = []

  for (const file of publicFiles.filter((path) => path !== SCOPE_FILE)) {
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(literal)) {
      messages.push(`${relative(REPO, file)}:${lineAt(source, match.index)} writes the section kind ${match[0]}; only scope.ts does`)
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
      messages.push(`${relative(REPO, COMPOSITION_FILE)}:${lineAt(source, found.index)} value-imports ${path}`)
    }
  }

  return messages
}

function screenReaches(): readonly string[] {
  return walkValueImports([BOOK_FREE_SCREEN_FILE, SCREEN_EVIDENCE_FILE], SCREEN_FORBIDDEN, [], new Map()).offences
}

/** The screen is run through the market's capability, which an import walk cannot follow: the call
 *  states `venueBlind`, and the one screen that reads the venues' listings honours it. */
function venueBlindGaps(): readonly string[] {
  const gaps: string[] = []

  if (!VENUE_BLIND_SET_RE.test(readFileSync(BOOK_FREE_SCREEN_FILE, 'utf8'))) {
    gaps.push(`${relative(REPO, BOOK_FREE_SCREEN_FILE)} does not run the screen with venueBlind: true`)
  }

  if (!VENUE_BLIND_READ_RE.test(readFileSync(CRYPTO_SCREEN_FILE, 'utf8'))) {
    gaps.push(`${relative(REPO, CRYPTO_SCREEN_FILE)} no longer reads venueBlind`)
  }

  return gaps
}

function unscopedMarkets(): readonly string[] {
  return PUBLIC_BRIEF_MARKETS.filter((market) => market === UNSCOPED_MARKET)
}
