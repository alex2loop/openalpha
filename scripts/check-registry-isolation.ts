#!/usr/bin/env bun
import { Glob } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const RUNTIME_SRC = resolve(import.meta.dir, '../src')
const STATIC_SPEC_RE = /\b(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/gs
const BARE_SPEC_RE = /\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]\s*\)?/g

/** One registered unit per folder, reachable from outside only through the factory that builds it.
 *  `shared` names the single module a sibling may import where one unit genuinely derives from
 *  another; a family without one admits no sibling imports at all. */
interface Family {
  readonly label: string
  readonly root: string
  readonly factory: RegExp
  readonly shared?: string
}

const FAMILIES: readonly Family[] = [
  {
    label: 'market',
    root: `${RUNTIME_SRC}/trading/markets`,
    factory: /export\s+function\s+create[A-Za-z0-9]+Market\s*\(/,
    shared: 'api',
  },
  {
    label: 'venue',
    root: `${RUNTIME_SRC}/trading/venues`,
    factory: /export\s+function\s+create[A-Za-z0-9]+Venue\s*\(/,
  },
]

interface ImportRef {
  readonly specifier: string
  readonly index: number
}

interface Violation {
  readonly file: string
  readonly line: number
  readonly message: string
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

function targetOf(fromFile: string, specifier: string): string | null {
  let base: string

  if (specifier.startsWith('@/')) {
    base = `${RUNTIME_SRC}/${specifier.slice(2)}`
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier)
  } else {
    return null
  }

  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

/** The unit a file belongs to, or null for a helper at the family root that every unit may share. */
function groupOf(family: Family, file: string): string | null {
  if (!file.startsWith(`${family.root}/`)) {
    return null
  }

  const [group, child] = file.slice(family.root.length + 1).split('/')

  return group === undefined || child === undefined ? null : group
}

function isRootFile(family: Family, file: string): boolean {
  return file.slice(family.root.length + 1).split('/').length === 2
}

function isFactoryEntry(family: Family, file: string): boolean {
  return isRootFile(family, file) && family.factory.test(readFileSync(file, 'utf8'))
}

function isSharedEntry(family: Family, file: string): boolean {
  return (
    family.shared !== undefined && isRootFile(family, file) && file.endsWith(`/${family.shared}.ts`)
  )
}

function sourceFiles(root: string): readonly string[] {
  return [...new Glob('**/*.ts').scanSync(root)]
    .map((file) => resolve(root, file))
    .filter((file) => !file.endsWith('.test.ts'))
}

function scanOutside(family: Family, root: string): readonly Violation[] {
  const violations: Violation[] = []

  for (const file of sourceFiles(root)) {
    if (groupOf(family, file) !== null) {
      continue
    }

    const source = readFileSync(file, 'utf8')

    for (const imported of importsOf(source)) {
      const target = targetOf(file, imported.specifier)

      if (target !== null && groupOf(family, target) !== null && !isFactoryEntry(family, target)) {
        violations.push({
          file,
          line: lineAt(source, imported.index),
          message: `${family.label} internal import '${imported.specifier}' — import only a ${family.label} factory`,
        })
      }
    }
  }

  return violations
}

function scanCross(family: Family): readonly Violation[] {
  const violations: Violation[] = []

  if (!existsSync(family.root)) {
    return violations
  }

  for (const file of sourceFiles(family.root)) {
    const own = groupOf(family, file)

    if (own === null) {
      continue
    }

    const source = readFileSync(file, 'utf8')

    for (const imported of importsOf(source)) {
      const target = targetOf(file, imported.specifier)
      const other = target === null ? null : groupOf(family, target)

      if (other === null || other === own || (target !== null && isSharedEntry(family, target))) {
        continue
      }

      violations.push({
        file,
        line: lineAt(source, imported.index),
        message: sharedAdvice(family, own, other),
      })
    }
  }

  return violations
}

function sharedAdvice(family: Family, own: string, other: string): string {
  const remedy =
    family.shared === undefined
      ? `no ${family.label} may reach into another`
      : `import '${other}/${family.shared}' instead`

  return `${family.label} '${own}' imports '${other}' internals — ${remedy}`
}

function displayPath(file: string): string {
  return file.replace(`${RUNTIME_SRC}/`, '')
}

const violations = [
  ...FAMILIES.flatMap((family) => [
    ...scanOutside(family, RUNTIME_SRC),
    ...scanCross(family),
  ]),
]

if (violations.length > 0) {
  process.stderr.write(`FAIL: ${violations.length} registry-isolation violation(s):\n`)

  for (const violation of violations) {
    process.stderr.write(
      `  ${displayPath(violation.file)}:${violation.line} — ${violation.message}\n`
    )
  }

  process.exit(1)
}

process.stdout.write(`check-registry-isolation: PASS (${FAMILIES.length} families)\n`)
