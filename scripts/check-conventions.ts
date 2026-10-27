#!/usr/bin/env bun
import { Glob } from 'bun'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SRC_ROOTS = ['src']

// The one surface that owns a terminal. Same path as biome.json's noConsole override — the two
// gates must name the same directory or one of them is lying about where console is allowed.
const CONSOLE_ALLOWED = 'src/cli/'

// A comment may legitimately name any of the forbidden forms — the rules read code only.
const COMMENT_RE = /^\s*(\/\/|\/?\*)/

// Reading the environment belongs to the layers that turn it into config: the config loader, the
// composition root that injects it, and the CLI entry. Everything else takes the value as an
// argument.
const ENV_ALLOWED = [
  'src/core/config/',
  'src/app/daemon-subsystems.ts',
  'src/cli/env.ts',
  'src/cli/terminal.ts',
]

interface Rule {
  readonly label: string
  readonly pattern: RegExp
  /** Files the rule does not apply to. */
  readonly exemptFile?: (path: string) => boolean
  /** Lines the rule tolerates (e.g. `: any` is allowed on a catch clause). */
  readonly exemptLine?: RegExp
}

const RULES: readonly Rule[] = [
  {
    label: 'raw `throw new Error(` — throw a typed error from core/errors.ts instead',
    pattern: /throw new Error\(/,
  },
  {
    label: '`export default` — named exports only',
    pattern: /export default\b/,
    // An ambient `declare module '*.md'` can only type a text import as a default export.
    exemptFile: (path) => path.endsWith('.d.ts'),
  },
  {
    label: '`: any` outside a catch clause — narrow from `unknown` instead',
    pattern: /:\s*any\b/,
    exemptLine: /\bcatch\b/,
  },
  {
    label: 'console.* outside cli/ — log through the injected logger (it scrubs)',
    pattern: /console\.(log|error|warn|info|debug)\b/,
    exemptFile: (path) => path.startsWith(CONSOLE_ALLOWED),
  },
  {
    label: 'process.env outside config/boot/cli entry — take the value as an argument',
    pattern: /process\.env\b/,
    exemptFile: (path) => ENV_ALLOWED.some((allowed) => path.startsWith(allowed)),
  },
  {
    label: 'raw CLI summary/description — use a typed localized metadata descriptor',
    pattern: /\b(?:summary|describe):\s*['"`]/,
    exemptFile: (path) => !path.startsWith('src/cli/'),
  },
  {
    label: 'dangerouslySetInnerHTML - render JSX nodes; nothing reaches innerHTML',
    pattern: /dangerouslySetInnerHTML/,
  },
  {
    label: 'duplicated CLI registry metadata — spread the canonical CLI_COMMAND_METADATA entry',
    pattern: /\b(?:name|summary):\s*['"`]/,
    exemptFile: (path) => path !== 'src/cli/registry.ts',
  },
]

async function collectSources(): Promise<Map<string, readonly string[]>> {
  const sources = new Map<string, readonly string[]>()
  const glob = new Glob('**/*.{ts,tsx}')

  for (const root of SRC_ROOTS) {
    for await (const rel of glob.scan({ cwd: `${ROOT}/${root}` })) {
      const path = `${root}/${rel}`
      sources.set(path, (await Bun.file(`${ROOT}/${path}`).text()).split('\n'))
    }
  }

  return sources
}

function violations(rule: Rule, sources: Map<string, readonly string[]>): string[] {
  const hits: string[] = []

  for (const [path, lines] of sources) {
    if (rule.exemptFile?.(path)) {
      continue
    }

    lines.forEach((line, index) => {
      if (COMMENT_RE.test(line) || rule.exemptLine?.test(line)) {
        return
      }

      if (rule.pattern.test(line)) {
        hits.push(`  ${path}:${index + 1}: ${line.trim()}`)
      }
    })
  }

  return hits
}

const sources = await collectSources()
let failed = false

for (const rule of RULES) {
  const hits = violations(rule, sources)

  if (hits.length > 0) {
    console.error(`FAIL: ${rule.label}`)
    console.error(hits.join('\n'))
    failed = true
  }
}

if (failed) {
  process.exit(1)
}

console.log(`check-conventions: PASS (${sources.size} files, ${RULES.length} rules)`)
