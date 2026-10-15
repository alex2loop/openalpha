#!/usr/bin/env bun
// SDK surface gate. Inspects the three package entries (`index.ts`, `cli/api.ts`, `app/api.ts`)
// and the canonical `CORE_PUBLIC` list, and locks the published surface to a committed
// snapshot. Two rules:
//
//   1. A shared contract is declared in exactly one file — nobody re-declares `Storage` locally.
//   2. Every name an entry exports is either consumed in-tree or declared in the allowlist with a
//      non-empty reason naming the consumer it waits for.
//
// The extractor reads value declarations through Bun's transpiler, so destructuring and
// multi-variable statements are seen as the compiler sees them, and reads what the transpiler erases
// (interfaces, type aliases, type-only lists) from the export statements themselves. Forbidden forms
// (`export *`, default export, `export =`, or any other export kind) are reported — a name is never
// silently omitted.
import { $ } from 'bun'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const RUNTIME_SRC = `${ROOT}/src`
const CONSUMER_ROOTS = [RUNTIME_SRC]
const SNAPSHOT_DEFAULT = resolve(import.meta.dir, 'sdk-surface.snapshot')

// The four package entries. Treated as entries rather than "barrels": a re-export in one entry does
// not count as an in-tree consumer of a name another entry publishes.
const ENTRIES = [
  { name: 'index', path: `${RUNTIME_SRC}/index.ts` },
  { name: 'cli', path: `${RUNTIME_SRC}/cli/api.ts` },
  { name: 'app', path: `${RUNTIME_SRC}/app/api.ts` },
] as const

// Names an entry exports that nothing in-tree consumes yet. Each entry is a promise: the consumer
// named beside it is coming. A bare unexplained name is not acceptable — the reason must be
// non-empty. Remove the entry when it lands — that is the point of the list.
const SDK_ALLOWLIST: ReadonlyMap<string, string> = new Map<string, string>([])

// A contract every module talks through. Two declarations of one of these names means two contracts
// wearing one name — the drift this rule exists to prevent.
const UNIQUE_CONTRACTS = ['Storage', 'EventBus', 'Memory', 'Logger']

interface ExportedName {
  readonly entry: string
  readonly name: string
}

interface ExtractResult {
  readonly names: readonly string[]
  readonly errors: readonly string[]
}

const failures: string[] = []

function fail(msg: string): void {
  failures.push(msg)
}

// --- Export extractor ---------------------------------------------------------------------

const TRANSPILER = new Bun.Transpiler({ loader: 'ts' })
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT_RE = /(^|\s)\/\/.*$/gm
const EXPORT_STATEMENT_RE = /^export\b.*$/gm
const EXPORT_LIST_RE = /^export\s+(?:type\s+)?\{([^}]*)\}/gm
const TYPE_DECLARATION_RE = /^export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm
const SUPPORTED_EXPORT_RE =
  /^export\s+(?:type\s+)?\{|^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|enum|interface|type|const|let|var)\b/
const FORBIDDEN_EXPORTS: readonly (readonly [RegExp, string])[] = [
  [/^export\s*\*\s*as\b/, 'export * as'],
  [/^export\s*\*/, 'export *'],
  [/^export\s*=/, 'export ='],
  [/^export\s+default\b/, 'default export'],
]

/** Collects every name an entry publishes, plus any forbidden-form errors. Pure: no global state. */
function extractExports(sourceText: string, entryName: string, filePath: string): ExtractResult {
  const source = sourceText.replace(BLOCK_COMMENT_RE, '').replace(LINE_COMMENT_RE, '$1')
  const errors = (source.match(EXPORT_STATEMENT_RE) ?? [])
    .map(unsupportedFormOf)
    .filter((kind) => kind !== undefined)
    .map((kind) => forbiddenMessage(entryName, filePath, kind))
  const names = new Set([...listedNames(source), ...typeDeclarationNames(source)])

  try {
    for (const name of TRANSPILER.scan(source).exports) {
      names.add(name)
    }
  } catch (error: unknown) {
    errors.push(`${entryName}: ${String(error)}`)
  }

  names.delete('default')

  return { names: [...names], errors }
}

/** The forbidden form a statement uses, or the head of one no rule here reads; undefined when the
 *  extractor sees every name it publishes. */
function unsupportedFormOf(statement: string): string | undefined {
  const forbidden = FORBIDDEN_EXPORTS.find(([pattern]) => pattern.test(statement))

  if (forbidden !== undefined) {
    return forbidden[1]
  }

  return SUPPORTED_EXPORT_RE.test(statement) ? undefined : statement.split(/\s+/, 3).join(' ')
}

/** `export { A, B as C }` and `export type { D }` publish `A`, `C` and `D`: an alias publishes the
 *  bound name, and an inline `type` marker is not part of it. */
function listedNames(source: string): string[] {
  return [...source.matchAll(EXPORT_LIST_RE)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((specifier) => specifier.trim().replace(/^type\s+/, ''))
      .filter((specifier) => specifier !== '')
      .map((specifier) => specifier.split(/\s+as\s+/).pop() ?? specifier)
  )
}

function typeDeclarationNames(source: string): string[] {
  return [...source.matchAll(TYPE_DECLARATION_RE)].flatMap((match) => match[1] ?? [])
}

function forbiddenMessage(entryName: string, filePath: string, kind: string): string {
  return `${entryName} (${relativePath(filePath)}): unsupported export form '${kind}' — the extractor would silently omit names`
}

// --- Consumer / contract rules -----------------------------------------------------------

async function assertSingleDeclaration(name: string): Promise<void> {
  const declaredAs = `^export (interface|type) ${name}( |<|=|$)`
  const raw = await $`grep -rnE ${declaredAs} ${RUNTIME_SRC} --include="*.ts"`
    .text()
    .catch(() => '')
  const declarations = raw.trim().split('\n').filter(Boolean)

  if (declarations.length > 1) {
    fail(`'${name}' is declared in more than one file:\n${declarations.join('\n')}`)
  }
}

async function assertConsumed(name: string, entryName: string): Promise<void> {
  const allowReason = SDK_ALLOWLIST.get(name)
  if (allowReason !== undefined) {
    if (allowReason.trim() === '') {
      fail(`'${name}' is in SDK_ALLOWLIST with an empty reason — name the consumer it waits for`)
    }

    return
  }

  const excludeEntries = ENTRIES.map((entry) => {
    const file = relativePath(entry.path).split('/').pop()
    return file === undefined ? '' : `--exclude=${file}`
  }).filter((flag) => flag !== '')
  const hits = await $`grep -rlw ${name} ${CONSUMER_ROOTS} --include="*.ts" ${excludeEntries}`
    .text()
    .catch(() => '')

  if (!hits.trim()) {
    fail(
      `'${name}' is exported by ${entryName} but appears nowhere else — a stale export, unless ` +
        'you add it to SDK_ALLOWLIST with a non-empty reason naming the consumer it waits for'
    )
  }
}

// --- Snapshot ---------------------------------------------------------------------------

function collectSurface(): ExportedName[] {
  const surface: ExportedName[] = []

  for (const entry of ENTRIES) {
    const source = readFileSync(entry.path, 'utf8')
    const result = extractExports(source, entry.name, entry.path)

    for (const error of result.errors) {
      fail(error)
    }

    for (const name of result.names) {
      surface.push({ entry: entry.name, name })
    }
  }

  return surface
}

function collectCorePublicLines(): string[] {
  const raw = execFileSync('bun', [resolve(import.meta.dir, 'check-dag.ts'), '--list-core-public'], {
    encoding: 'utf8',
  })
  return raw.trim().split('\n').filter(Boolean)
}

function snapshotLines(surface: readonly ExportedName[], corePublic: readonly string[]): string[] {
  return [
    ...surface.map((entry) => `${entry.entry}:${entry.name}`),
    ...corePublic,
  ].sort()
}

function relativePath(absPath: string): string {
  return absPath.replace(`${ROOT}/`, '')
}

function runSnapshotCheck(snapshotPath: string): void {
  const surface = collectSurface()
  const corePublic = collectCorePublicLines()
  const actual = snapshotLines(surface, corePublic)

  const committed = readFileSync(snapshotPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

  const actualSet = new Set(actual)
  const committedSet = new Set(committed)

  const missing = committed.filter((line) => !actualSet.has(line))
  const extra = actual.filter((line) => !committedSet.has(line))

  if (missing.length > 0) {
    fail(`snapshot has entries no longer published (run with --update to regenerate):\n  ${missing.join('\n  ')}`)
  }

  if (extra.length > 0) {
    fail(`new exports not in snapshot (run with --update to regenerate):\n  ${extra.join('\n  ')}`)
  }
}

function updateSnapshot(snapshotPath: string): void {
  const surface = collectSurface()
  const corePublic = collectCorePublicLines()
  const lines = snapshotLines(surface, corePublic)
  const header =
    '# SDK surface snapshot — regenerated by `bun scripts/check-sdk-exports.ts --update`.\n' +
    '# Entry-qualified export lines (`index:`/`cli:`/`app:`) and canonical CORE_PUBLIC subpaths.\n\n'
  writeFileSync(snapshotPath, `${header}${lines.join('\n')}\n`)
  console.log(`check-sdk-exports: snapshot updated (${lines.length} entries) → ${relativePath(snapshotPath)}`)
}

// --- Package export map check -----------------------------------------------------------

function assertPackageExportsApp(): void {
  const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as {
    exports: Record<string, string>
  }
  const appEntry = pkg.exports['./app']

  if (appEntry !== './src/app/api.ts') {
    fail(
      `package export map must point './app' at './src/app/api.ts', got '${appEntry ?? 'undefined'}'`
    )
  }
}

// --- Extractor self-check ---------------------------------------------------------------

function runExtractorSelfCheck(): void {
  const fixture = [
    'export function funcDecl(): void {}',
    'export class ClassDecl {}',
    'export enum EnumDecl { A }',
    'export interface InterfaceDecl {}',
    'export type TypeAlias = string',
    'export const singleVar = 1',
    'export const { d1, d2 } = { d1: 1, d2: 2 }',
    'export const [a1, a2] = [1, 2]',
    'export { reExported }',
    'export { internal as published }',
    'export type { typeReExported }',
    "export { type inlineType, valueReExported } from './x'",
    'export const first: Map<string, number> = new Map(), second = 2',
  ].join('\n')

  const result = extractExports(fixture, 'selfcheck', 'selfcheck.ts')
  const names = [...result.names].sort()
  const expected = [
    'ClassDecl',
    'EnumDecl',
    'InterfaceDecl',
    'TypeAlias',
    'a1',
    'a2',
    'd1',
    'd2',
    'first',
    'funcDecl',
    'inlineType',
    'published',
    'reExported',
    'second',
    'singleVar',
    'typeReExported',
    'valueReExported',
  ]

  const missing = expected.filter((name) => !names.includes(name))
  if (missing.length > 0) {
    fail(`extractor self-check missing names: ${missing.join(', ')}`)
  }

  const extra = names.filter((name) => !expected.includes(name))
  if (extra.length > 0) {
    fail(`extractor self-check found unexpected names: ${extra.join(', ')}`)
  }

  if (result.errors.length > 0) {
    fail(`extractor self-check reported errors on a valid fixture: ${result.errors.join('; ')}`)
  }

  assertForbiddenFails('export * from "./x"', 'export *')
  assertForbiddenFails('export * as ns from "./x"', 'export * as')
  assertForbiddenFails('export default function () {}', 'default export')
  assertForbiddenFails('export = value', 'export =')
  assertForbiddenFails('export namespace Space {}', 'export namespace')
}

function assertForbiddenFails(source: string, label: string): void {
  const result = extractExports(source, 'selfcheck', 'selfcheck-forbidden.ts')
  if (result.errors.length === 0) {
    fail(`extractor self-check did not flag forbidden form '${label}'`)
  }
}

// --- Main --------------------------------------------------------------------------------

async function main(): Promise<void> {
  runExtractorSelfCheck()
  assertPackageExportsApp()

  for (const name of UNIQUE_CONTRACTS) {
    await assertSingleDeclaration(name)
  }

  for (const entry of ENTRIES) {
    const source = readFileSync(entry.path, 'utf8')
    const result = extractExports(source, entry.name, entry.path)

    for (const error of result.errors) {
      fail(error)
    }

    for (const name of result.names) {
      await assertConsumed(name, entry.name)
    }
  }

  const updateMode = process.argv.includes('--update')
  const snapshotArg = process.argv.find((arg) => arg.startsWith('--snapshot='))
  const snapshotPath =
    snapshotArg !== undefined ? resolve(snapshotArg.slice('--snapshot='.length)) : SNAPSHOT_DEFAULT

  if (updateMode) {
    updateSnapshot(snapshotPath)
    return
  }

  runSnapshotCheck(snapshotPath)

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL: ${failure}`)
    }

    process.exit(1)
  }

  const surface = collectSurface()
  console.log(
    `check-sdk-exports: PASS (${ENTRIES.length} entries, ${surface.length} exports, ${UNIQUE_CONTRACTS.length} unique contracts)`
  )
}

void main()
