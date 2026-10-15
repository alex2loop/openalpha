import { Glob } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SRC = `${import.meta.dir}/../src`

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  core: [],
  i18n: [],
  ai: ['core'],
  engine: ['core', 'ai'],
  tools: ['core', 'engine'],
  persistence: ['core'],
  memory: ['core'],
  scheduler: ['core', 'engine'],
  commands: ['core', 'engine', 'scheduler'],
  plugins: ['core', 'engine'],
  social: ['core', 'engine', 'i18n'],
  trading: ['core', 'engine', 'persistence', 'i18n'],
  channels: ['core', 'engine', 'commands', 'i18n'],
  cli: [
    'core',
    'ai',
    'engine',
    'persistence',
    'memory',
    'plugins',
    'social',
    'tools',
    'trading',
    'channels',
    'commands',
    'scheduler',
    'i18n',
  ],
  app: [
    'core',
    'i18n',
    'ai',
    'engine',
    'tools',
    'persistence',
    'memory',
    'scheduler',
    'commands',
    'plugins',
    'social',
    'trading',
    'channels',
    'cli',
  ],
}

// core has no api.ts: a barrel would close a cycle (core files import each other) and would make
// every consumer load zod/pino/undici. Its public surface is declared here instead. A new core
// file is INTERNAL until it is added to this set — that addition is the reviewable act of widening
// the kernel's API, exactly what an `export` from an api.ts would be.
const CORE_PUBLIC: ReadonlySet<string> = new Set([
  'brand',
  'channels',
  'container',
  'errors',
  'events',
  'fs',
  'ids',
  'limits',
  'llm',
  'logging/correlation',
  'logging/logger',
  'logging/paths',
  'logging/retention',
  'logging/inspection',
  'memory-key',
  'stream-events',
  'tool',
  'types/agent-pause',
  'types/social',
  'types/budget',
  'types/cli-command',
  'types/command',
  'types/exact',
  'types/locale',
  'types/memory',
  'types/plugin',
  'types/run',
  'types/session',
  'types/storage',
  'types/usage',
  'config/load',
  'config/resolve',
  'config/validate',
  'http-client',
  'security/agent-directories',
  'security/binary',
  'session-queue',
  'security/credentials',
  'security/output-pipeline',
  'security/path-policy',
  'security/private-files',
  'security/sanitize',
  'ssrf/network-policy',
  'ssrf/pinned-fetch',
  'utils/collections',
  'utils/concurrency',
  'utils/cost',
  'utils/cron',
  'utils/duration',
  'utils/freeze',
  'utils/footer',
  'utils/glob',
  'utils/hash',
  'utils/message',
  'utils/retry',
  'utils/text',
  'utils/time',
  'utils/version',
])
// engine/research is a bounded context the module gate cannot see: it lives inside `engine`, so the
// cross-module rules below never apply to it and nothing stops the rest of engine reaching into any
// of its files. Until the spec promotes it to a module, this set IS its public API. Every entry
// widens the surface that promotion has to carry, so add one only when the alternative is worse.
const RESEARCH_PUBLIC: ReadonlySet<string> = new Set([
  'agent-result',
  'contracts',
  'coordinator',
  'display/issue-summary',
  'display/progress',
  'events',
  'evidence/model',
  'evidence/parse',
  'evidence/schemas',
  'retrieval/retrieval',
])
const RESEARCH_DIR = `${SRC}/engine/research/`
const I18N_INDEX = `${SRC}/i18n/index.ts`
// index.ts sits above every module, like `app`, and is checked, not skipped.
const BARREL_DEPS: readonly string[] = [...(ALLOWED.app ?? []), 'app']
const NO_DEEP_ALLOW: ReadonlySet<string> = new Set()
// i18n is a single-file leaf; only the bare specifier is importable.
const KERNEL_MODULES = new Set(['core', 'i18n'])
const MODULE_NAME_RE = /^[a-z0-9-]+$/

// `--list-core-public` prints the sorted canonical CORE_PUBLIC set and exits, so the SDK surface
// checker can consume it without duplicating this list in a second source.
if (process.argv.includes('--list-core-public')) {
  for (const subpath of [...CORE_PUBLIC].sort()) {
    process.stdout.write(`core/${subpath}\n`)
  }

  process.exit(0)
}
// Static import/export-from statements, incl. multiline bodies. The middle part can never
// contain a quote (specifiers are the only strings in an import clause), so [^'"]*? cannot
// jump across statements. Type-only imports follow the same module boundaries as value imports.
const STATIC_SPEC_RE = /\b(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*'([^']+)'/gs
// Side-effect (`import './x'`) and dynamic (`import('x')`) imports — always value imports.
const BARE_SPEC_RE = /\bimport\s*(?:\(\s*)?'([^']+)'\s*\)?/g

interface Violation {
  file: string
  line: number
  message: string
}

interface FoundImport {
  specifier: string
  index: number
  isTypeOnly: boolean
  statementKind: 'import' | 'export'
  clause?: string
}

interface Importer {
  name: string
  allowed: readonly string[]
  deepAllow: ReadonlySet<string>
}

if (!existsSync(SRC)) {
  process.stderr.write(
    `check-dag: SRC not found: ${SRC} (run from repo root via \`bun scripts/check-dag.ts\`)\n`,
  )
  process.exit(1)
}

const files = [...new Glob('**/*.ts').scanSync(SRC)].map((file) => `${SRC}/${file}`)
const exists = new Set(files)
const violations: Violation[] = []

const moduleOf = (absPath: string): string | null => {
  const rel = absPath.replace(`${SRC}/`, '')
  const seg = rel.split('/')[0]
  return seg && MODULE_NAME_RE.test(seg) ? seg : null
}

const resolveRelative = (fromFile: string, spec: string): string | null => {
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (exists.has(candidate)) return candidate
  }
  return null
}

const isRootBarrel = (absPath: string): boolean =>
  absPath === `${SRC}/index.ts`

const importerOf = (file: string): Importer | null => {
  if (isRootBarrel(file)) {
    const name = file.slice(SRC.length + 1)
    return { name, allowed: BARREL_DEPS, deepAllow: NO_DEEP_ALLOW }
  }

  const module = moduleOf(file)
  if (!module) return null

  return { name: module, allowed: ALLOWED[module] ?? [], deepAllow: NO_DEEP_ALLOW }
}

const lineAt = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length

const scanImports = (source: string): FoundImport[] => {
  const found: FoundImport[] = []
  for (const m of source.matchAll(STATIC_SPEC_RE)) {
    const specifier = m[1]
    if (specifier !== undefined) {
      const statement = m[0]
      const typeOnly = /^\s*(?:import|export)\s+type\s+/.test(statement)
      const statementKind = /^\s*import\b/.test(statement) ? 'import' : 'export'
      const clause = statement.match(/\b(?:import|export)\s+(?:type\s+)?([^'\"]*?)\s+from\s*'/s)?.[1]

      found.push({ specifier, index: m.index, isTypeOnly: typeOnly, statementKind, clause })
    }
  }
  for (const m of source.matchAll(BARE_SPEC_RE)) {
    const specifier = m[1]
    if (specifier !== undefined) {
      found.push({ specifier, index: m.index, isTypeOnly: false, statementKind: 'import' })
    }
  }
  return found
}

// Kernel modules have no api.ts, so their importable surface is enumerated rather than re-exported.
const kernelSurfaceIssue = (depModule: string, subpath: string | undefined): string | null => {
  if (depModule === 'i18n') {
    return subpath === undefined ? null : `deep import '@/i18n/${subpath}' — only '@/i18n' is importable`
  }

  if (subpath === undefined) return `'@/core' has no barrel — import a specific public core module`
  if (CORE_PUBLIC.has(subpath)) return null

  return (
    `'@/core/${subpath}' is internal to core — import its public facade, or add it to ` +
    `CORE_PUBLIC in check-dag.ts if it belongs in the kernel API`
  )
}

// Resolves an import to its path under engine/research, or null when it does not point there.
const researchTargetOf = (file: string, specifier: string): string | null => {
  const alias = /^@\/engine\/research\/(.+)$/.exec(specifier)
  if (alias?.[1] !== undefined) return alias[1]

  if (!specifier.startsWith('.')) return null

  const abs = resolveRelative(file, specifier)

  return abs?.startsWith(RESEARCH_DIR) === true
    ? abs.slice(RESEARCH_DIR.length).replace(/\.ts$/, '')
    : null
}

const researchSurfaceIssue = (file: string, specifier: string): string | null => {
  if (file.startsWith(RESEARCH_DIR)) return null

  const target = researchTargetOf(file, specifier)
  if (target === null || RESEARCH_PUBLIC.has(target)) return null

  return (
    `'@/engine/research/${target}' is internal to research — import one of its public entry ` +
    `points, or add it to RESEARCH_PUBLIC in check-dag.ts if it belongs in that API`
  )
}

const checkFile = (file: string, importer: Importer, source: string): void => {
  for (const found of scanImports(source)) {
    const researchIssue = researchSurfaceIssue(file, found.specifier)

    if (researchIssue !== null) {
      violations.push({ file, line: lineAt(source, found.index), message: researchIssue })
    }

    let depModule: string | null = null
    let subpath: string | undefined
    const aliasMatch = /^@\/([a-z0-9-]+)(?:\/(.*))?$/.exec(found.specifier)

    if (aliasMatch?.[1] !== undefined) {
      depModule = aliasMatch[1]
      subpath = aliasMatch[2]
    } else if (found.specifier.startsWith('.')) {
      const target = resolveRelative(file, found.specifier)
      const targetModule = target ? moduleOf(target) : null
      if (targetModule && targetModule !== importer.name) depModule = targetModule
    }

    if (!depModule || depModule === importer.name) continue

    const isI18nLocaleTypeImport =
      file === I18N_INDEX &&
      found.statementKind === 'import' &&
      found.specifier === '@/core/types/locale' &&
      found.isTypeOnly &&
      found.clause?.replace(/\s/g, '') === '{Locale}'

    if (isI18nLocaleTypeImport) continue

    const line = lineAt(source, found.index)
    if (!importer.allowed.includes(depModule)) {
      violations.push({ file, line, message: `${importer.name} -> ${depModule} not allowed (DAG)` })
      continue
    }

    if (KERNEL_MODULES.has(depModule)) {
      const kernelIssue = kernelSurfaceIssue(depModule, subpath)
      if (kernelIssue) violations.push({ file, line, message: kernelIssue })
      continue
    }

    if (subpath !== 'api' && !importer.deepAllow.has(found.specifier)) {
      violations.push({
        file,
        line,
        message: `deep import '@/${depModule}${subpath ? `/${subpath}` : ''}' — only '@/${depModule}/api' is importable`,
      })
    }
  }
}

for (const file of files) {
  const importer = importerOf(file)
  if (!importer) continue

  checkFile(file, importer, readFileSync(file, 'utf8'))
}

const rel = (path: string): string => path.replace(`${SRC}/`, '')

if (violations.length > 0) {
  process.stderr.write(`FAIL: ${violations.length} DAG violation(s):\n`)
  for (const violation of violations) {
    process.stderr.write(`  ${rel(violation.file)}:${violation.line} — ${violation.message}\n`)
  }
  process.exit(1)
}

process.stdout.write(`check-dag: PASS (${files.length} files, 0 violations)\n`)
