#!/usr/bin/env bun
import { Glob } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const RUNTIME_SRC = resolve(import.meta.dir, '../src')
const TRADING_SRC = `${RUNTIME_SRC}/trading`
const TRADING_API = `${TRADING_SRC}/api.ts`
const INTERNAL_BARRELS = [`${TRADING_SRC}/config/index.ts`, `${TRADING_SRC}/types/index.ts`]
const FORBIDDEN_FOLDERS = ['classify', 'data', 'storage', 'utils', 'common', 'helpers']
const FORBIDDEN_API_EXPORTS = [
  'AlertStore',
  'BriefStore',
  'BriefSubscriptionStore',
  'LedgerStore',
  'Market',
  'MarketDataStore',
  'MarketRegistry',
  'ProfileStore',
  'Source',
  'SourceRegistry',
  'Stage',
  'StageRegistry',
  'SuggestionStore',
  'TradingStores',
] as const
const LEGACY_IDENTIFIERS = [
  'BarsCapability',
  'BriefCapability',
  'DetectCapability',
  'EventsCapability',
  'MacroCapability',
  'MarketDataCapabilities',
  'MarketOverview',
  'OverviewCapability',
  'PortfolioToolService',
  'RenderCapability',
  'ReviewCapability',
  'SignalScore',
  'SignalsCapability',
  'StageContext',
  'StageResult',
  'SuggestionReview',
  'SuggestionStatus',
  'TradingPresentationOptions',
] as const
const STATIC_SPEC_RE = /\b(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/gs
const BARE_SPEC_RE = /\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]\s*\)?/g
const EXPORT_DECL_RE = /^export\s+(?:const|function|class|type|interface)\s+([A-Za-z0-9_]+)/gm
const SURFACE_IMPORT_RE = /^@\/(?:app|channels|cli|server)(?:\/|$)/

interface ImportRef {
  readonly specifier: string
  readonly index: number
}

interface Violation {
  readonly file: string
  readonly line: number
  readonly message: string
}

interface CycleSearch {
  readonly visiting: Set<string>
  readonly visited: Set<string>
  readonly path: string[]
}

function importsOf(source: string): readonly ImportRef[] {
  const imports: ImportRef[] = []

  for (const match of source.matchAll(STATIC_SPEC_RE)) {
    if (match[1] !== undefined) {
      imports.push({ specifier: match[1], index: match.index })
    }
  }

  for (const match of source.matchAll(BARE_SPEC_RE)) {
    if (match[1] !== undefined) {
      imports.push({ specifier: match[1], index: match.index })
    }
  }

  return imports
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function resolveImport(
  fromFile: string,
  specifier: string,
  files: ReadonlySet<string>
): string | null {
  let base: string

  if (specifier.startsWith('@/')) {
    base = `${RUNTIME_SRC}/${specifier.slice(2)}`
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier)
  } else {
    return null
  }

  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (files.has(candidate)) {
      return candidate
    }
  }

  return null
}

function relativeToRuntime(file: string): string {
  return file.replace(`${RUNTIME_SRC}/`, '')
}

function scanRuntimeBoundary(files: readonly string[]): readonly Violation[] {
  const fileSet = new Set(files)
  const violations: Violation[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const insideTrading = file.startsWith(`${TRADING_SRC}/`)

    for (const imported of importsOf(source)) {
      const target = resolveImport(file, imported.specifier, fileSet)
      const tradingAlias =
        imported.specifier === '@/trading' || imported.specifier.startsWith('@/trading/')
      const importsTrading = target !== null && target.startsWith(`${TRADING_SRC}/`)

      if (!insideTrading && (tradingAlias || importsTrading)) {
        if (imported.specifier !== '@/trading/api') {
          violations.push({
            file,
            line: lineAt(source, imported.index),
            message: `deep trading import '${imported.specifier}' — use '@/trading/api'`,
          })
        }
      }

      if (insideTrading && SURFACE_IMPORT_RE.test(imported.specifier)) {
        violations.push({
          file,
          line: lineAt(source, imported.index),
          message: `trading domain imports surface '${imported.specifier}'`,
        })
      }
    }
  }

  return violations
}

function scanPublicApi(): readonly Violation[] {
  const source = readFileSync(TRADING_API, 'utf8')
  const violations: Violation[] = []

  for (const name of FORBIDDEN_API_EXPORTS) {
    const match = new RegExp(`\\b${name}\\b`).exec(source)

    if (match !== null) {
      violations.push({
        file: TRADING_API,
        line: lineAt(source, match.index),
        message: `private trading contract '${name}' is exported`,
      })
    }
  }

  return violations
}

function scanLegacyVocabulary(files: readonly string[]): readonly Violation[] {
  const violations: Violation[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')

    for (const name of LEGACY_IDENTIFIERS) {
      const match = new RegExp(`\\b${name}\\b`).exec(source)

      if (match !== null) {
        violations.push({
          file,
          line: lineAt(source, match.index),
          message: `legacy trading identifier '${name}' remains`,
        })
      }
    }
  }

  return violations
}

function duplicateExportViolations(files: readonly string[]): readonly Violation[] {
  const homes = new Map<string, string[]>()
  const violations: Violation[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(EXPORT_DECL_RE)) {
      if (match[1] === undefined) {
        continue
      }

      const paths = homes.get(match[1]) ?? []

      paths.push(file)
      homes.set(match[1], paths)
    }
  }

  for (const [name, paths] of homes) {
    if (new Set(paths).size > 1) {
      violations.push({
        file: paths.join(', '),
        line: 1,
        message: `exported contract '${name}' has more than one home`,
      })
    }
  }

  return violations
}

function buildTradingGraph(files: readonly string[]): ReadonlyMap<string, ReadonlySet<string>> {
  const fileSet = new Set(files)
  const graph = new Map<string, ReadonlySet<string>>()

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const dependencies = new Set<string>()

    for (const imported of importsOf(source)) {
      const target = resolveImport(file, imported.specifier, fileSet)

      if (target !== null && target.startsWith(`${TRADING_SRC}/`) && target !== file) {
        dependencies.add(target)
      }
    }

    graph.set(file, dependencies)
  }

  return graph
}

function findCycle(graph: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] | null {
  const search: CycleSearch = { visiting: new Set(), visited: new Set(), path: [] }

  for (const node of graph.keys()) {
    const cycle = visit(node, graph, search)

    if (cycle !== null) {
      return cycle
    }
  }

  return null
}

function visit(
  node: string,
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  search: CycleSearch
): readonly string[] | null {
  if (search.visited.has(node)) {
    return null
  }

  if (search.visiting.has(node)) {
    const start = search.path.indexOf(node)
    return [...search.path.slice(start), node]
  }

  search.visiting.add(node)
  search.path.push(node)

  for (const dependency of graph.get(node) ?? []) {
    const cycle = visit(dependency, graph, search)

    if (cycle !== null) {
      return cycle
    }
  }

  search.path.pop()
  search.visiting.delete(node)
  search.visited.add(node)
  return null
}

function structuralViolations(): readonly Violation[] {
  const paths = [
    ...INTERNAL_BARRELS,
    ...FORBIDDEN_FOLDERS.map((folder) => `${TRADING_SRC}/${folder}`),
  ]

  return paths
    .filter(existsSync)
    .map((file) => ({ file, line: 1, message: 'forbidden trading barrel or legacy folder exists' }))
}

function printViolations(violations: readonly Violation[]): void {
  process.stderr.write(`FAIL: ${violations.length} trading architecture violation(s):\n`)

  for (const violation of violations) {
    process.stderr.write(
      `  ${relativeToRuntime(violation.file)}:${violation.line} — ${violation.message}\n`
    )
  }
}

const runtimeFiles = [...new Glob('**/*.ts').scanSync(RUNTIME_SRC)].map((file) =>
  resolve(RUNTIME_SRC, file)
)
const tradingFiles = runtimeFiles.filter((file) => file.startsWith(`${TRADING_SRC}/`))
const violations = [
  ...scanRuntimeBoundary(runtimeFiles),
  ...scanPublicApi(),
  ...scanLegacyVocabulary(tradingFiles),
  ...duplicateExportViolations(tradingFiles),
  ...structuralViolations(),
]
const cycle = findCycle(buildTradingGraph(tradingFiles))

if (cycle !== null) {
  violations.push({
    file: cycle.map(relativeToRuntime).join(' -> '),
    line: 1,
    message: 'trading import cycle',
  })
}

if (violations.length > 0) {
  printViolations(violations)
  process.exit(1)
}

process.stdout.write(
  `check-trading-gates: PASS (${tradingFiles.length} trading files, 0 boundary, cycle, or legacy violations)\n`
)
