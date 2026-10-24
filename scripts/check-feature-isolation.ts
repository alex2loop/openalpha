#!/usr/bin/env bun
// Feature-isolation gate (spec §5-§6): trading is vertical slices, and this reads the edges between
// them. kernel and render are leaves; a feature reaches only the features its row below names; only
// wiring calls a service factory. The allowlist exists so a migration can land in move-sized
// commits — it only ever shrinks, and a stale entry fails, so no temporary edge survives quietly.
//
// --strict additionally holds the §8.5 size ceilings, measured over trading minus markets/ and
// sources/ (both are governed by check-registry-isolation and their own budgets).
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const REPO = resolve(import.meta.dir, '..')
const TRADING = 'src/trading'
const ROOT = `${REPO}/${TRADING}`
const ALLOWLIST_PATH = 'scripts/feature-isolation-allowlist.json'
const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+'([^']+)'/gm
const EXPORT_TYPE_RE = /^export (?:interface|type) /gm
const EXPORT_FN_RE = /^export (?:async )?function /gm
const SERVICE_FACTORY_RE = /create[A-Z]\w*Service/
const STORE_SEGMENT_RE = /\/store(?:\/|$)/
const UNMEASURED_AREAS = new Set(['markets', 'sources'])
// Spec §13: what an agent may never see. NAV is reconstructable from ticker plus quantity against
// public prices, so a raw quantity is as secret as the money itself. Weights, return fractions,
// day stamps and caveat codes are what a model reasons over.
const LLM_FORBIDDEN_RE =
  /\b(?:viewAbsolute|historyAbsolute|rebalanceAbsolute|valueBase|costBasisBase|navBase)\b/
const LLM_REACHING_RE = /^features\/suggestion\/(?:debate|pipeline\/(?:[a-z-]*evidence|schemas))\/?|^features\/[a-z-]+\/tools(?:\.ts$|\/)/
const LEAF_CONSUMERS = new Set(['render', 'markets', 'sources', 'wiring'])

// ledger reads market-data because a trade cannot be written honestly without it: the ticker is
// resolved, the day comes from that market's calendar, and a foreign-currency cost is converted at
// write time. The rest of the table is spec §6 F2 verbatim.
const FEATURE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // `suggestion` for the same reason `order` carries `ledger`: a buy that lands with nothing
  // watching the name earns an exit plan, and the write confirmation prints it, rendered by the
  // module that owns that row rather than by a second layout. The arrow does not come back —
  // `suggestion` declares no ledger dependency — so no cycle.
  ledger: ['market-data', 'suggestion'],
  // A watched ticker is resolved to the instrument that lists it before it can be stored, and
  // only market-data can do that: a list of unresolvable names is not one to save.
  profile: ['market-data'],
  'market-data': [],
  portfolio: ['ledger', 'profile', 'market-data'],
  alerts: ['market-data', 'portfolio', 'suggestion'],
  suggestion: ['market-data', 'portfolio', 'profile'],
  brief: ['market-data', 'portfolio', 'suggestion', 'alerts'],
  // An order cannot be placed honestly without both: market-data resolves the ticker and dates the
  // fill by the market's own calendar, and portfolio is where every fill is mirrored and where the
  // cash a cap measures is folded. `ledger` is the third because the confirmation a fill prints *is*
  // the row it wrote, rendered by the module that owns that row rather than by a second layout.
  order: ['market-data', 'portfolio', 'ledger'],
  // Sector strength and the macro series catalogue are market-data's; themes reads nothing else.
  themes: ['market-data'],
})

/** The measured tree, not an aspiration: a ceiling nothing can reach is a ceiling nobody enforces.
 *  These are a ratchet - a number that falls is edited down with it, and raising one is the
 *  reviewable act that says the module grew on purpose, so its reason belongs in that commit. */
const CEILINGS = Object.freeze({ files: 576, exportedTypes: 984, exportedFns: 1223 })

interface Allowlist {
  readonly edges: readonly string[]
}

interface Violation {
  readonly edge: string
  readonly line: number
  readonly message: string
}

function areaOf(path: string): string {
  const segments = path.split('/')
  const head = segments[0]

  if (head === undefined || segments.length === 1) {
    return 'root'
  }

  if (head !== 'features') {
    return head
  }

  const feature = segments[1]

  return feature === undefined ? 'root' : `feature:${feature.replace(/\.ts$/, '')}`
}

function featureOf(area: string): string | null {
  return area.startsWith('feature:') ? area.slice('feature:'.length) : null
}

function targetArea(fromRel: string, specifier: string): string | null {
  if (specifier.startsWith('@/trading/')) {
    return areaOf(specifier.slice('@/trading/'.length))
  }

  if (!specifier.startsWith('.')) {
    return null
  }

  const rel = relative(ROOT, resolve(dirname(`${ROOT}/${fromRel}`), specifier))

  return rel.startsWith('..') ? null : areaOf(rel)
}

function crossFeatureMessage(from: string, to: string, specifier: string): string | null {
  const consumer = featureOf(from)
  const provider = featureOf(to)

  if (consumer === null || provider === null || consumer === provider) {
    return null
  }

  if (STORE_SEGMENT_RE.test(specifier)) {
    return `feature '${consumer}' reads '${provider}' store — go through its service`
  }

  return FEATURE_DEPENDENCIES[consumer]?.includes(provider) === true
    ? null
    : `feature '${consumer}' imports '${provider}' — not in its dependency row`
}

function edgeMessage(from: string, to: string, clause: string, specifier: string): string | null {
  if (from === 'kernel' && (LEAF_CONSUMERS.has(to) || featureOf(to) !== null)) {
    return `kernel imports '${to}' — the kernel is a leaf`
  }

  if (from === 'render' && (featureOf(to) !== null || to === 'wiring')) {
    return `render imports '${to}' — the display kernel is a leaf`
  }

  if (UNMEASURED_AREAS.has(from) && featureOf(to) !== null) {
    return `'${from}' imports '${to}' — data providers never read a feature`
  }

  if (featureOf(from) !== null && to === 'wiring') {
    return `feature '${featureOf(from)}' imports wiring — composition points inward only`
  }

  if (featureOf(to) !== null && from !== 'wiring' && SERVICE_FACTORY_RE.test(clause)) {
    return `'${from}' calls a service factory of '${to}' — only wiring composes services`
  }

  return crossFeatureMessage(from, to, specifier)
}

function violationsIn(rel: string, source: string): readonly Violation[] {
  const found: Violation[] = []
  const from = areaOf(rel)

  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1]
    const specifier = match[2]

    if (clause === undefined || specifier === undefined) {
      continue
    }

    const to = targetArea(rel, specifier)
    const message = to === null ? null : edgeMessage(from, to, clause, specifier)

    if (message !== null) {
      found.push({
        edge: `${TRADING}/${rel}->${specifier}`,
        line: source.slice(0, match.index).split('\n').length,
        message,
      })
    }
  }

  return found
}

/** A tool result and a persona prompt are the two things an agent reads verbatim. Allowlist-free:
 *  a new absolute-money read on one of these paths is a build failure, not a reviewable edge. */
function llmBoundaryViolation(rel: string, source: string): string | null {
  if (!LLM_REACHING_RE.test(rel)) {
    return null
  }

  const match = LLM_FORBIDDEN_RE.exec(source)

  return match === null
    ? null
    : `'${match[0]}' reaches an agent from ${rel} — spec §13: no money, no quantities`
}

interface Metrics {
  readonly files: number
  readonly exportedTypes: number
  readonly exportedFns: number
}

function scan(): { readonly violations: readonly Violation[]; readonly metrics: Metrics } {
  const violations: Violation[] = []
  let files = 0
  let exportedTypes = 0
  let exportedFns = 0

  for (const rel of new Glob('**/*.ts').scanSync(ROOT)) {
    const source = readFileSync(`${ROOT}/${rel}`, 'utf8')

    violations.push(...violationsIn(rel, source))

    const boundary = llmBoundaryViolation(rel, source)

    if (boundary !== null) {
      violations.push({ edge: `${TRADING}/${rel}->llm`, line: 1, message: boundary })
    }

    if (UNMEASURED_AREAS.has(areaOf(rel))) {
      continue
    }

    files += 1
    exportedTypes += [...source.matchAll(EXPORT_TYPE_RE)].length
    exportedFns += [...source.matchAll(EXPORT_FN_RE)].length
  }

  return { violations, metrics: { files, exportedTypes, exportedFns } }
}

function reportEdges(violations: readonly Violation[], allowed: Set<string>): number {
  const seen = new Set<string>()
  let failures = 0

  for (const violation of violations) {
    seen.add(violation.edge)

    if (allowed.has(violation.edge)) {
      continue
    }

    failures += 1
    process.stderr.write(`  ${violation.edge} (line ${violation.line}) — ${violation.message}\n`)
  }

  for (const edge of allowed) {
    if (!seen.has(edge)) {
      failures += 1
      process.stderr.write(`  stale allowlist entry: ${edge} — remove it from ${ALLOWLIST_PATH}\n`)
    }
  }

  return failures
}

function reportCeilings(metrics: Metrics): number {
  const over = Object.entries(CEILINGS).filter(
    ([key, ceiling]) => metrics[key as keyof Metrics] > ceiling
  )

  for (const [key, ceiling] of over) {
    process.stderr.write(
      `  ${key}=${metrics[key as keyof Metrics]} exceeds ${ceiling} — the budget is a ratchet: ` +
        `merge or delete until it holds, or raise the line deliberately in ${'check-feature-isolation.ts'}\n`
    )
  }

  // The ratchet tightens as well as holds: a measurement under its ceiling is the new ceiling,
  // so every cleanup locks in instead of leaving slack for the next change to spend.
  const slack = Object.entries(CEILINGS).filter(
    ([key, ceiling]) => metrics[key as keyof Metrics] < ceiling
  )

  for (const [key, ceiling] of slack) {
    process.stderr.write(
      `  ratchet down: ${key}=${metrics[key as keyof Metrics]} is under its ceiling ${ceiling} — ` +
        `lower CEILINGS.${key} to ${metrics[key as keyof Metrics]} in this commit\n`
    )
  }

  return over.length + slack.length
}

const allowlist: Allowlist = await Bun.file(`${REPO}/${ALLOWLIST_PATH}`).json()
const { violations, metrics } = scan()
const strict = process.argv.includes('--strict')
const failures = reportEdges(violations, new Set(allowlist.edges))
const overCeiling = strict ? reportCeilings(metrics) : 0

process.stdout.write(
  `feature-isolation: files=${metrics.files} exportedTypes=${metrics.exportedTypes} ` +
    `exportedFns=${metrics.exportedFns} ` +
    `(ceilings ${CEILINGS.files}/${CEILINGS.exportedTypes}/${CEILINGS.exportedFns})\n`
)

if (failures + overCeiling > 0) {
  process.stderr.write(`FAIL: ${failures + overCeiling} feature-isolation violation(s)\n`)
  process.exit(1)
}

process.stdout.write(`check-feature-isolation: PASS (${allowlist.edges.length} allowed edge(s))\n`)
