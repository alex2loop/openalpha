#!/usr/bin/env bun
// Unused-export gate. AGENTS.md: "Minimize exports" and "an unused export is a bug". Reports any
// exported name that no other file imports or re-exports. Conservative: a module reached by a
// namespace import is skipped, because per-name usage cannot be proved for it.
import { basename, dirname, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SOURCE_ROOTS = ['src']
// Scanned for imports only: a gate script is a real consumer, but its own exports are not API.
const CONSUMER_ROOTS = ['scripts']
const ALIAS_ROOTS: readonly (readonly [string, string])[] = [
  ['@/', 'src'],
]

interface Manifest {
  readonly name: string
  readonly bin?: Record<string, string>
  readonly exports?: Record<string, string>
}

// The published surface is read from package.json `bin` and `exports`, not listed here, so a
// published entry added or removed there takes effect without an edit in this file.
const MANIFEST = JSON.parse(await Bun.file(resolve(ROOT, 'package.json')).text()) as Manifest
// `@openalpha/runtime/app` -> one file, the way a consumer of the package resolves it.
const SPECIFIER_FILES = publishedSpecifiers(MANIFEST)
// Reached by the binary, the bundler, or a tool outside the import graph.
const ENTRY_FILES: readonly string[] = [
  ...Object.values(MANIFEST.bin ?? {}).map(rootRelative),
  ...SPECIFIER_FILES.values(),
]

if (ENTRY_FILES.length === 0) {
  console.error('FAIL: package.json declares no bin or .ts exports.')
  console.error('The gate is stale, not the code.')
  process.exit(1)
}

// AGENTS.md's sanctioned barrels are a module's public surface by definition: a re-export with no
// cross-module consumer yet is the API being wider than today's callers, not dead code. A facade
// that is not named `api.ts` declares itself by waiving Biome's barrel rule, so the waiver is read
// rather than a second list of paths being kept in step with it.
const BARREL_FILES: ReadonlySet<string> = new Set(['api.ts', 'index.ts'])
const BARREL_WAIVER = 'lint/performance/noBarrelFile'

// Public facades AGENTS.md keeps deliberately callerless. `path#name`.
const KNOWN_UNUSED: ReadonlySet<string> = new Set<string>([])

const DECLARATION_RE =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/gm
const NAMED_BLOCK_RE = /^export\s+(?:type\s+)?\{([^}]*)\}(?:\s+from\s+['"]([^'"]+)['"])?/gm
const IMPORT_BLOCK_RE = /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm
const NAMESPACE_IMPORT_RE = /^import\s+(?:type\s+)?\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/gm
// The lazy-command shape: `(await import('@/cli/commands/x')).xCommand`.
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)\s*\)?\s*\.\s*(\w+)/g
const SPECIFIER_SPLIT_RE = /\s*,\s*/
const ALIAS_SPLIT_RE = /\s+as\s+/
const INLINE_TYPE_RE = /^type\s+/

const exportsByFile = new Map<string, Set<string>>()
const used = new Set<string>()
const opaque = new Set<string>()
const barrels = new Set<string>()

for (const root of SOURCE_ROOTS) {
  await scan(root, { publishes: true })
}

for (const root of CONSUMER_ROOTS) {
  await scan(root, { publishes: false })
}

const violations: string[] = []

for (const [file, names] of exportsByFile) {
  const rel = relative(ROOT, file)

  if (ENTRY_FILES.includes(rel) || barrels.has(file) || opaque.has(file)) {
    continue
  }

  for (const name of names) {
    const key = `${rel}#${name}`

    if (!used.has(key) && !KNOWN_UNUSED.has(key)) {
      violations.push(key)
    }
  }
}

if (violations.length > 0) {
  console.log(`FAIL: ${violations.length} export(s) nothing imports.`)
  console.log('  Delete the export, or add it to KNOWN_UNUSED with the reason it stays public.')
  console.log()

  for (const violation of violations.sort()) {
    console.log(`  ${violation}`)
  }

  process.exit(1)
}

console.log(`OK: every export in ${exportsByFile.size} file(s) has a consumer.`)

async function scan(root: string, options: { readonly publishes: boolean }): Promise<void> {
  const dir = resolve(ROOT, root)
  const glob = new Bun.Glob('**/*.{ts,tsx}')

  for await (const rel of glob.scan({ cwd: dir })) {
    await collect(resolve(dir, rel), options.publishes)
  }
}

async function collect(file: string, publishes: boolean): Promise<void> {
  const text = await Bun.file(file).text()
  const names = new Set<string>()

  for (const match of text.matchAll(DECLARATION_RE)) {
    addName(names, match[1])
  }

  for (const match of text.matchAll(NAMED_BLOCK_RE)) {
    const source = match[2]

    // `export { a as b } from './x'` publishes `b` here and consumes `a` from `./x`.
    for (const entry of specifiers(match[1])) {
      names.add(entry.local)

      if (source !== undefined) {
        markUsed(file, source, entry.source)
      }
    }
  }

  for (const match of text.matchAll(IMPORT_BLOCK_RE)) {
    for (const entry of specifiers(match[1])) {
      markUsed(file, match[2], entry.source)
    }
  }

  for (const match of text.matchAll(DYNAMIC_IMPORT_RE)) {
    const name = match[2]

    if (name !== undefined) {
      markUsed(file, match[1], name)
    }
  }

  for (const match of text.matchAll(NAMESPACE_IMPORT_RE)) {
    const target = resolveSpecifier(file, match[1])

    if (target !== null) {
      opaque.add(target)
    }
  }

  if (BARREL_FILES.has(basename(file)) || text.includes(BARREL_WAIVER)) {
    barrels.add(file)
  }

  if (publishes && names.size > 0) {
    exportsByFile.set(file, names)
  }
}

function addName(names: Set<string>, name: string | undefined): void {
  if (name !== undefined) {
    names.add(name)
  }
}

interface Specifier {
  /** The name as the source module exports it. */
  readonly source: string
  /** The name this file binds or publishes it under; equals `source` without `as`. */
  readonly local: string
}

function specifiers(block: string): readonly Specifier[] {
  const entries: Specifier[] = []

  for (const raw of block.split(SPECIFIER_SPLIT_RE)) {
    const [source = '', local] = raw.trim().replace(INLINE_TYPE_RE, '').split(ALIAS_SPLIT_RE)

    if (source !== '') {
      entries.push({ source: source.trim(), local: (local ?? source).trim() })
    }
  }

  return entries
}

function markUsed(from: string, specifier: string, name: string): void {
  const target = resolveSpecifier(from, specifier)

  if (target !== null) {
    used.add(`${relative(ROOT, target)}#${name}`)
  }
}

function resolveSpecifier(from: string, specifier: string): string | null {
  const mapped = SPECIFIER_FILES.get(specifier)

  if (mapped !== undefined) {
    return resolve(ROOT, mapped)
  }

  const base = aliasBase(specifier) ?? (specifier.startsWith('.') ? resolve(dirname(from), specifier) : null)

  if (base === null) {
    return null
  }

  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (Bun.file(candidate).size > 0) {
      return candidate
    }
  }

  return null
}

function rootRelative(path: string): string {
  return relative(ROOT, resolve(ROOT, path))
}

function publishedSpecifiers(manifest: Manifest): ReadonlyMap<string, string> {
  const specifiers = new Map<string, string>()

  for (const [subpath, path] of Object.entries(manifest.exports ?? {})) {
    if (!path.endsWith('.ts')) {
      continue
    }

    const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`

    specifiers.set(specifier, rootRelative(path))
  }

  return specifiers
}

function aliasBase(specifier: string): string | null {
  for (const [prefix, root] of ALIAS_ROOTS) {
    if (specifier.startsWith(prefix)) {
      return resolve(ROOT, root, specifier.slice(prefix.length))
    }
  }

  return null
}
