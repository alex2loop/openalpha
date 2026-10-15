#!/usr/bin/env bun
// The licence here is MIT, and `@openalpha/runtime` invites being embedded in somebody else's
// application. A copyleft dependency would quietly pass its own terms through to every one of
// those: the README promises MIT, and the tree would be saying otherwise. It arrives one
// transitive package at a time, with no error and nothing to notice until someone reads the
// licences, so the tree is checked instead of trusted.
//
// NOT a legal review. It reads the `license` field each package declares and refuses the families
// whose terms reach a work that merely includes the package. One that declares nothing is refused
// too, because an unknown licence is the one you cannot reason about.
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')

// Families whose terms can reach a work that merely includes the package.
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EUPL|SSPL|CDDL|CPL|OSL|CeCILL|RPL|QPL|APSL)\b/i

// A declared licence we accept. Anything outside this is reported rather than guessed at.
const PERMISSIVE = new Set([
  '0BSD',
  'APACHE-2.0',
  'BLUEOAK-1.0.0',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'PYTHON-2.0',
  'UNLICENSE',
  'WTFPL',
  'ZLIB',
])

// Paths that are not dependencies: a package's own test fixtures carry their own package.json and
// routinely declare no licence.
const NOT_A_DEPENDENCY = /\/(test|tests|fixtures?|__tests__|examples?|benchmarks?)\//

interface Offender {
  readonly name: string
  readonly version: string
  readonly license: string
  readonly reason: string
}

/** True when every alternative an OR offers is unacceptable; one permissive branch is enough. */
const satisfiable = (expr: string): boolean => {
  const terms = expr
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((t) => t.trim())

  return terms.some((term) =>
    term
      .split(/\s+AND\s+/i)
      .every((part) => PERMISSIVE.has(part.replace(/\+$/, '').trim().toUpperCase()))
  )
}

const declaredLicense = (pkg: Record<string, unknown>): string => {
  const direct = pkg.license

  if (typeof direct === 'string') {
    return direct
  }

  if (direct !== null && typeof direct === 'object' && 'type' in direct) {
    const type = (direct as { type?: unknown }).type
    return typeof type === 'string' ? type : ''
  }

  const legacy = pkg.licenses

  if (Array.isArray(legacy)) {
    const types = legacy
      .map((entry) =>
        entry !== null && typeof entry === 'object' && 'type' in entry
          ? String((entry as { type?: unknown }).type ?? '')
          : ''
      )
      .filter((t) => t !== '')

    return types.length > 0 ? types.join(' OR ') : ''
  }

  return ''
}

const offenders: Offender[] = []
let checked = 0

for await (const rel of new Bun.Glob('node_modules/**/package.json').scan({ cwd: ROOT })) {
  if (NOT_A_DEPENDENCY.test(`/${rel}`)) {
    continue
  }

  let pkg: Record<string, unknown>

  try {
    pkg = (await Bun.file(resolve(ROOT, rel)).json()) as Record<string, unknown>
  } catch {
    continue
  }

  // No version means it is not an installed package: a type stub shim, a config shard, a fixture.
  if (typeof pkg.version !== 'string' || typeof pkg.name !== 'string') {
    continue
  }

  checked += 1

  const license = declaredLicense(pkg)
  const entry = { name: pkg.name, version: pkg.version, license: license || '(none declared)' }

  if (license === '') {
    offenders.push({ ...entry, reason: 'declares no licence' })
    continue
  }

  if (COPYLEFT.test(license) && !satisfiable(license)) {
    offenders.push({ ...entry, reason: 'copyleft' })
    continue
  }

  if (!satisfiable(license)) {
    offenders.push({ ...entry, reason: 'not a licence this gate recognises' })
  }
}

if (checked === 0) {
  console.log('FAIL: no packages found. Run `bun install` first.')
  process.exit(1)
}

if (offenders.length > 0) {
  console.log(`FAIL: ${offenders.length} dependency licence(s) to resolve, of ${checked} checked.`)
  console.log()

  for (const o of offenders) {
    console.log(`  ${o.name}@${o.version}  ${o.license}  - ${o.reason}`)
  }

  console.log()
  console.log('A copyleft package reaches the application this code ships inside. Replace it, or')
  console.log('add it to PERMISSIVE in this script once you have read the terms and they allow it.')
  process.exit(1)
}

console.log(`check-dep-licenses: PASS (${checked} packages, no copyleft, none undeclared)`)
