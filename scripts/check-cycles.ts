import { Glob } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const SRC = `${import.meta.dir}/../src`
if (!existsSync(SRC)) {
  console.error(`check-cycles: SRC not found: ${SRC} (run from repo root via \`bun scripts/check-cycles.ts\`)`)
  process.exit(1)
}
const files = [...new Glob('**/*.{ts,tsx}').scanSync(SRC)].map((f) => `${SRC}/${f}`)
const exists = new Set(files)
const resolveMod = (from: string, spec: string): string | null => {
  let base: string
  if (spec.startsWith('@/')) base = `${SRC}/${spec.slice(2)}`
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (exists.has(c)) return c
  return null
}
const graph = new Map<string, Set<string>>()
const importRe = /(?:import|export)\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/g
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const deps = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = importRe.exec(src))) {
    if (m[1]) continue
    const t = resolveMod(f, m[2]!)
    if (t && t !== f) deps.add(t)
  }
  graph.set(f, deps)
}
let idx = 0
const stack: string[] = []
const onStack = new Set<string>()
const index = new Map<string, number>()
const low = new Map<string, number>()
const cycles: string[][] = []
const strong = (v: string): void => {
  index.set(v, idx)
  low.set(v, idx)
  idx++
  stack.push(v)
  onStack.add(v)
  for (const w of graph.get(v) ?? []) {
    if (!index.has(w)) {
      strong(w)
      low.set(v, Math.min(low.get(v)!, low.get(w)!))
    } else if (onStack.has(w)) {
      low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
  }
  if (low.get(v) === index.get(v)) {
    const comp: string[] = []
    let w: string
    do {
      w = stack.pop()!
      onStack.delete(w)
      comp.push(w)
    } while (w !== v)
    if (comp.length > 1) cycles.push(comp)
  }
}
for (const f of files) if (!index.has(f)) strong(f)
const rel = (p: string): string => p.replace(`${SRC}/`, '')
if (cycles.length > 0) {
  console.error(`FAIL: ${cycles.length} value-import cycle(s):`)
  for (const c of cycles) console.error('  ' + c.map(rel).join(' <-> '))
  process.exit(1)
}
console.log(`check-cycles: PASS (${files.length} files, 0 cycles)`)
