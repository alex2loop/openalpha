// Scaffold a migration file (Laravel's `make:migration`). The filename carries the timestamp and
// IS the id, so getting it right by hand is the one manual step in an otherwise automatic pipeline:
// gen-migrations.ts registers whatever lands in migrations/, and boot applies what the ledger lacks.
//
// A dev script, not a CLI command: it writes into the source tree, which a shipped binary has no
// access to. Plugins ship their own migrations through MigrateOptions.migrations instead.
//
// Usage: bun run migration:new add_watchlist_table

import { readdir } from 'node:fs/promises'

const MIGRATIONS_DIR = 'src/persistence/migrations'
const NAME_RE = /^[a-z][a-z0-9_]*$/
const MIGRATION_FILE_RE = /^\d{4}_\d{2}_\d{2}_\d{6}_(.+)\.ts$/

const name = process.argv[2]

if (name === undefined || !NAME_RE.test(name)) {
  console.error('usage: bun run migration:new <snake_case_name>   e.g. add_watchlist_table')
  process.exit(2)
}

// Same shape gen-migrations.ts parses: YYYY_MM_DD_HHMMSS. Local time — the operator reads it as
// "when I wrote this", and only the lexicographic order across files matters.
const now = new Date()
const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
].join('_')

const file = `${stamp}_${name}.ts`
const existing = await readdir(MIGRATIONS_DIR)
const clash = existing.find((entry) => MIGRATION_FILE_RE.exec(entry)?.[1] === name)

if (clash !== undefined) {
  console.error(`a migration named '${name}' already exists: ${clash}`)
  process.exit(1)
}

const source = `import type { MigrationDown, MigrationUp } from '@/persistence/types'

export const up: MigrationUp = async (tx, dialect) => {
  await tx.execute(
    \`CREATE TABLE IF NOT EXISTS example (
      id \${dialect.autoIncrementPk},
      created_at BIGINT NOT NULL
    )\`
  )
}

export const down: MigrationDown = async (tx) => {
  await tx.execute('DROP TABLE IF EXISTS example')
}
`

await Bun.write(`${MIGRATIONS_DIR}/${file}`, source)

console.log(`created ${MIGRATIONS_DIR}/${file}`)
console.log('write matching `up` and `down` bodies; remove `down` only when intentionally irreversible.')
