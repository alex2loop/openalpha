import { Glob } from 'bun'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOTS = [
  resolve(`${import.meta.dir}/../src`),
]
for (const s of ROOTS) {
  if (!existsSync(s)) {
    console.error(`check-depth: SRC not found: ${s} (run from repo root via \`bun scripts/check-depth.ts\`)`)
    process.exit(1)
  }
}

const isExempt = (p: string) => p.endsWith('.d.ts') || p.endsWith('.generated.ts')

const files = ROOTS.flatMap((root) => [...new Glob('**/*.{ts,tsx}').scanSync(root)])
const violations: string[] = []

for (const rel of files) {
  if (isExempt(rel)) continue

  const parts = rel.split('/')
  const depth = parts.length - 1 // directory depth from src (excludes filename)

  if (depth >= 5) {
    violations.push(rel)
  }
}

if (violations.length > 0) {
  console.error(
    `FAIL: ${violations.length} file(s) at depth 5+ from src/ (rule #3 ceiling is 4; flatten or restructure):`,
  )
  for (const v of violations.sort()) console.error(`  ${v}`)
  process.exit(1)
}

console.log(
  `check-depth: PASS (${files.length} files, 0 depth-5+ violations)`,
)
