#!/usr/bin/env bun
// Import-path gate. Within src, relative imports may climb at most one level (`../`).
// A deeper climb (`../../` or more) that still resolves INSIDE src MUST use the `@/`
// alias instead. A climb that escapes src entirely (e.g. the app's package.json) is
// exempt -- `@/` (-> src) cannot address it. See AGENTS.md "Import paths".
// Exit 0 = clean. Any in-src deep relative import prints the offending lines and exits 1.
import { dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SRC = resolve(ROOT, 'src')

const DEEP = /^(\.\.\/){2,}/
const FROM = /from\s+['"]([^'"]+)['"]/g

const violations: string[] = []

const glob = new Bun.Glob('**/*.{ts,tsx}')

for await (const rel of glob.scan({ cwd: SRC })) {
  const file = resolve(SRC, rel)
  const lines = (await Bun.file(file).text()).split('\n')

  lines.forEach((line, i) => {
    FROM.lastIndex = 0
    let m: RegExpExecArray | null

    while ((m = FROM.exec(line)) !== null) {
      const spec = m[1]!

      if (!DEEP.test(spec)) {
        continue
      }

      const target = resolve(dirname(file), spec)

      if (target === SRC || target.startsWith(`${SRC}/`)) {
        violations.push(`src/${rel}:${i + 1}: ${line.trim()}`)
      }
    }
  })
}

if (violations.length > 0) {
  console.log(
    `FAIL: ${violations.length} deep relative import(s) (../../ or deeper) resolving inside src. Use the @/ alias.`
  )
  console.log(`  e.g. import { X } from '@/core/errors'   (not '../../errors')`)
  console.log(`  Rule: AGENTS.md "Import paths".`)
  console.log()

  for (const v of violations) {
    console.log(v)
  }

  process.exit(1)
}

console.log('check-imports: OK (no in-src ../../ deep relative imports).')
