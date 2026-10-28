#!/usr/bin/env bun
// Reachability gate. check-unused-exports asks whether each export has a consumer, which a cluster
// of files importing each other satisfies while nothing outside the cluster calls any of them. Two
// files that export only to one another pass that gate and ship forever. This walks the import
// graph from the package's real entry points instead, so a file nothing can reach is a failure.
//
// Entry points are read from package.json `bin` and `exports` rather than listed here: a new
// published entry must not need an edit in this file to be honoured, and an entry that is removed
// must not keep its subtree alive.
//
// Over-matching is the safe direction. A specifier found in a comment makes a file look reachable
// and the gate quieter; it can never invent a failure. So `from '...'` is matched anywhere rather
// than only in a parsed import clause.
import { Glob } from 'bun'
import { existsSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SRC = resolve(ROOT, 'src')
// Mirrors tsconfig.json `paths`.
const ALIAS_PREFIX = '@/'
const MANIFEST = JSON.parse(await Bun.file(resolve(ROOT, 'package.json')).text()) as Record<
  string,
  unknown
>
// `@openalpha/runtime/app` -> one file, from the same `exports` the entry points come from.
const SPECIFIER_FILES = publishedSpecifiers(MANIFEST)
// Extension-less specifiers resolve against these, in order, the way the bundler does.
const CANDIDATE_SUFFIXES: readonly string[] = [
  '',
  '.ts',
  '.tsx',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/api.ts',
]

// A file outside the import graph on purpose, with the reason it stays. `path`.
const KNOWN_UNREACHABLE: ReadonlySet<string> = new Set<string>([])

const FROM_RE = /\bfrom\s*['"]([^'"]+)['"]/g
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
// A page's `<script src>` and `<link href>`, which the bundler follows from an imported `.html`.
const HTML_ASSET_RE = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g
const HTML_SUFFIX = '.html'

interface Entry {
  readonly file: string
  readonly why: string
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

function resolveSpecifier(specifier: string, fromFile: string): string | undefined {
  const mapped = SPECIFIER_FILES.get(specifier)

  if (mapped !== undefined) {
    const direct = resolve(ROOT, mapped)

    return isFile(direct) ? direct : undefined
  }

  let base: string

  if (specifier.startsWith(ALIAS_PREFIX)) {
    base = resolve(SRC, specifier.slice(ALIAS_PREFIX.length))
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier)
  } else {
    return undefined
  }

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`

    if (isFile(candidate)) {
      return candidate
    }
  }

  return undefined
}

function specifiersOf(file: string, text: string): readonly string[] {
  const found: string[] = []
  const patterns = file.endsWith(HTML_SUFFIX) ? [HTML_ASSET_RE] : [FROM_RE, DYNAMIC_RE, BARE_IMPORT_RE]

  for (const re of patterns) {
    re.lastIndex = 0

    let match = re.exec(text)

    while (match !== null) {
      const specifier = match[1]

      if (specifier !== undefined) {
        found.push(specifier)
      }

      match = re.exec(text)
    }
  }

  return found
}

function publishedSpecifiers(manifest: Record<string, unknown>): ReadonlyMap<string, string> {
  const specifiers = new Map<string, string>()
  const name = manifest.name
  const exported = manifest.exports

  if (typeof name !== 'string' || typeof exported !== 'object' || exported === null) {
    return specifiers
  }

  for (const [subpath, path] of Object.entries(exported)) {
    if (typeof path === 'string' && path.endsWith('.ts')) {
      const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`

      specifiers.set(specifier, relative(ROOT, resolve(ROOT, path)))
    }
  }

  return specifiers
}

function collectEntries(manifest: Record<string, unknown>): readonly Entry[] {
  const found: Entry[] = []
  const bin = manifest.bin

  if (typeof bin === 'object' && bin !== null) {
    for (const [name, path] of Object.entries(bin)) {
      if (typeof path === 'string') {
        found.push({ file: path, why: `package.json bin.${name}` })
      }
    }
  }

  const exported = manifest.exports

  if (typeof exported === 'object' && exported !== null) {
    for (const [name, path] of Object.entries(exported)) {
      if (typeof path === 'string' && path.endsWith('.ts')) {
        found.push({ file: path, why: `package.json exports["${name}"]` })
      }
    }
  }

  return found
}

const entries = collectEntries(MANIFEST)

if (entries.length === 0) {
  console.log('FAIL: package.json declares no bin or .ts exports.')
  console.log('The gate is stale, not the graph.')
  process.exit(1)
}

const reached = new Set<string>()
const queue: string[] = []

for (const entry of entries) {
  const path = resolve(ROOT, entry.file)

  if (!isFile(path)) {
    console.log(`FAIL: ${entry.why} points at ${entry.file}, which is not a file.`)
    process.exit(1)
  }

  if (!reached.has(path)) {
    reached.add(path)
    queue.push(path)
  }
}

while (queue.length > 0) {
  const file = queue.pop() as string
  const text = await Bun.file(file).text()

  for (const specifier of specifiersOf(file, text)) {
    const target = resolveSpecifier(specifier, file)

    if (target !== undefined && !reached.has(target)) {
      reached.add(target)
      queue.push(target)
    }
  }
}

const sources = [...new Glob('**/*.{ts,tsx}').scanSync(SRC)]
  .filter((file) => !file.endsWith('.d.ts'))
  .map((file) => resolve(SRC, file))

const unreachable = sources
  .filter((file) => !reached.has(file))
  .map((file) => relative(ROOT, file))
  .filter((file) => !KNOWN_UNREACHABLE.has(file))
  .sort()

if (unreachable.length > 0) {
  console.log(`FAIL: ${unreachable.length} file(s) no entry point can reach:`)
  console.log()

  for (const file of unreachable) {
    console.log(`  ${file}`)
  }

  console.log()
  console.log('Delete them, import them, or add one to KNOWN_UNREACHABLE with the reason it stays.')
  process.exit(1)
}

console.log(
  `check-reachability: PASS (${sources.length} file(s) reachable from ` +
    `${entries.length} entry point(s))`
)
