import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Compiled binaries need static imports, so build-time codegen owns migration discovery.
// Anchored on this file, not the caller's cwd: a consumer repository runs it from its own root.
const MIGRATIONS_DIR = resolve(import.meta.dir, '../src/persistence/migrations')
const OUT = `${MIGRATIONS_DIR}/registry.generated.ts`
const MIGRATION_FILE_RE = /^(\d{4}_\d{2}_\d{2}_\d{6})_([a-z][a-z0-9_]*)\.ts$/
const NON_MIGRATION_FILES = new Set(['registry.generated.ts', 'runner.ts'])
const DOWN_EXPORT_RE = /^export\s+const\s+down\b/m

interface Entry {
  readonly id: string
  readonly alias: string
  readonly reversibility: 'reversible' | 'irreversible'
}

class MigrationGeneratorError extends Error {
  readonly code = 'invalid_migration_registry'
}

async function main(): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => !NON_MIGRATION_FILES.has(name))
    .sort()
  const entries = await collectEntries(files)

  await Bun.write(OUT, renderRegistry(entries))
  console.log(`registered ${entries.length} migration(s) → ${OUT}`)
}

async function collectEntries(files: readonly string[]): Promise<readonly Entry[]> {
  const entries: Entry[] = []
  const aliases = new Map<string, string>()

  for (const file of files) {
    const source = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    const entry = toEntry(file, source)
    const clash = aliases.get(entry.alias)

    if (clash !== undefined) {
      throw new MigrationGeneratorError(
        `${file} and ${clash} both generate the import alias '${entry.alias}' — rename one`
      )
    }

    aliases.set(entry.alias, file)
    entries.push(entry)
  }

  return entries
}

function toEntry(file: string, source: string): Entry {
  const name = MIGRATION_FILE_RE.exec(file)?.[2]

  if (name === undefined) {
    throw new MigrationGeneratorError(
      `${MIGRATIONS_DIR}/${file}: expected <YYYY_MM_DD_HHMMSS>_<snake_name>.ts`
    )
  }

  return {
    id: file.slice(0, -'.ts'.length),
    alias: `migration${pascalCase(name)}`,
    reversibility: DOWN_EXPORT_RE.test(source) ? 'reversible' : 'irreversible',
  }
}

function pascalCase(snake: string): string {
  return snake
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function renderRegistry(entries: readonly Entry[]): string {
  const imports = entries
    .map((entry) => `import * as ${entry.alias} from '@/persistence/migrations/${entry.id}'`)
    .join('\n')
  const rows = entries.map(renderEntry).join('\n')

  return `// AUTO-GENERATED registry.generated.ts by scripts/gen-migrations.ts — do not edit.
// Every valid migration file is registered here in filename order; an exported down marks it reversible.

import type { Migration } from '@/persistence/types'
${imports}

export const MIGRATIONS = [
${rows}
] as const satisfies readonly Migration[]
`
}

function renderEntry(entry: Entry): string {
  if (entry.reversibility === 'reversible') {
    return `  { id: '${entry.id}', reversibility: 'reversible', up: ${entry.alias}.up, down: ${entry.alias}.down },`
  }

  return `  { id: '${entry.id}', reversibility: 'irreversible', up: ${entry.alias}.up },`
}

await main()
