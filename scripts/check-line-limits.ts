#!/usr/bin/env bun
// File-size gate (spec §12) and the sole owner of the limit: a source file over MAX_FILE_LINES is a
// violation unless it is listed in known-exceptions.json with a reason in the PR that added it.
//
// Biome's `noExcessiveLinesPerFile` is deliberately not enabled. It cannot express a per-path
// waiver — its only lever is an override glob, which silently relaxes the limit for everything the
// glob matches — so running both left two counters disagreeing on the threshold and on the units,
// with the waiver list unable to bind the one that fires first.
//
// Blank lines are excluded, matching `noExcessiveLinesPerFunction` (skipBlankLines) and the
// blank-line paragraph style AGENTS.md requires: counting raw lines charges a file for the
// formatting the style guide mandates. Comments count — they are content a reader must hold.
//
// Function size is NOT checked here: Biome owns it, measuring a function's own body, which a brace
// counter cannot reproduce without a parser.
//
// Exit 0 = clean or every oversized file is documented. Exit 1 if a NEW one appears.
import { Glob } from 'bun'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SRC_ROOTS = [
  'src',
  'scripts/research-routing',
]
const ROOT_FILES = [
  'scripts/check-research-integrity-regressions.ts',
  'scripts/evaluate-research-routing.ts',
]
const MAX_FILE_LINES = 400

interface Exceptions {
  readonly files: readonly string[]
}

async function oversizedFiles(): Promise<Map<string, number>> {
  const oversized = new Map<string, number>()
  const paths = [...ROOT_FILES]
  const glob = new Glob('**/*.ts')

  for (const root of SRC_ROOTS) {
    for await (const rel of glob.scan({ cwd: `${ROOT}/${root}` })) {
      paths.push(`${root}/${rel}`)
    }
  }

  for (const path of paths) {
    const lines = await codeLines(path)

    if (lines > MAX_FILE_LINES) {
      oversized.set(path, lines)
    }
  }

  return oversized
}

async function codeLines(path: string): Promise<number> {
  const text = await Bun.file(`${ROOT}/${path}`).text()

  return text.split('\n').filter((line) => line.trim() !== '').length
}

const exceptions: Exceptions = await Bun.file(`${ROOT}/scripts/known-exceptions.json`).json()
const known = new Set(exceptions.files)
const oversized = await oversizedFiles()
const unknown = [...oversized].filter(([path]) => !known.has(path))

for (const [path, lines] of unknown) {
  console.error(`FAIL: ${path}: ${lines} code lines (max ${MAX_FILE_LINES})`)
}

if (unknown.length > 0) {
  console.error('Split it, or add the path to known-exceptions.json with a reason in the PR.')
  process.exit(1)
}

console.log(
  `check-line-limits: PASS (${oversized.size} exception(s), 0 new over ${MAX_FILE_LINES})`
)
