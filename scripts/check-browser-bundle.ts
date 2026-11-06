#!/usr/bin/env bun
// Browser bundle gate. The engine moves into a Web Worker, so everything the worker bundles must
// run in a browser. This builds the real bundle, then names the source file behind each import
// the browser cannot honour, so a leak is fixed where it is written rather than found at runtime.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildBrowser } from './browser-build'

const ROOT = resolve(import.meta.dir, '..')
const ENTRY = resolve(ROOT, 'src/app/browser/worker.ts')
const SRC_PREFIX = 'src/'
const SOURCE_SUFFIX = '.ts'
const NODE_PREFIX = 'node:'
const BUN_PREFIX = 'bun:'
const BUN_MODULE = 'bun'
const PACKAGES_DIR = 'node_modules/'

// No browser equivalent: filesystem, process, sockets and Node streams all need the host.
const DENIED_MODULES: ReadonlySet<string> = new Set([
  'fs',
  'os',
  'child_process',
  'net',
  'tls',
  'dns',
  'http',
  'https',
  'http2',
  'stream',
  'async_hooks',
])
// Bun's crypto polyfill is crypto-browserify, which breaks at runtime. Venue signing is the one
// caller, and it never runs without venue keys, which the web does not hold.
const CRYPTO_MODULE = 'crypto'
const CRYPTO_ALLOWED_PREFIX = 'src/trading/venues/'
// Host globals a browser worker does not define; a bare reference throws at call time.
const HOST_GLOBAL_RES: ReadonlyMap<string, RegExp> = new Map([
  ['Bun.', /\bBun\./],
  ['Buffer', /\bBuffer\b/],
  ['process.', /(?<![.\w])process\./],
  ['__dirname', /\b__dirname\b/],
  ['__filename', /\b__filename\b/],
  ['require(', /(?<![.\w])require\(/],
  ['setImmediate', /\bsetImmediate\b/],
  // A browser timer is a number: `.unref()` and `.ref()` throw on it. `unrefTimer` is the one
  // caller.
  ['.unref(', /\.unref\(/],
  ['.ref(', /\.ref\(/],
])
const TIMER_METHODS: ReadonlySet<string> = new Set(['.unref(', '.ref('])
const TIMER_METHOD_OWNER = 'src/core/utils/time.ts'
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/?\*)/

type Logs = Bun.BuildOutput['logs']
type Parents = ReadonlyMap<string, readonly string[]>

interface Leak {
  readonly source: string
  readonly what: string
}

const outdir = await mkdtemp(join(tmpdir(), 'browser-bundle-'))
process.chdir(ROOT)

try {
  const real = await buildBrowser({ entry: ENTRY, outdir, minify: false })
  const scan = await buildBrowser({ entry: ENTRY, outdir, minify: false, externalBuiltins: true })
  const parents = scan.metafile === undefined ? new Map() : parentsOf(scan.metafile)
  const leaks = scan.metafile === undefined ? [] : await leaksOf(scan.metafile, parents)

  report(real.logs, leaks, parents)
} finally {
  await rm(outdir, { recursive: true, force: true })
}

function report(logs: Logs, leaks: readonly Leak[], parents: Parents): void {
  const errors = logs.filter((log) => log.level === 'error')

  if (errors.length === 0 && leaks.length === 0) {
    console.log('check-browser-bundle: PASS')

    return
  }

  console.log('check-browser-bundle: FAIL')
  printBuildErrors(errors, parents)
  printLeaks(leaks)
  process.exitCode = 1
}

function printBuildErrors(errors: Logs, parents: Parents): void {
  if (errors.length === 0) {
    return
  }

  console.log()
  console.log(`Build errors (${errors.length}):`)

  for (const error of errors) {
    const file = error.position?.file ?? '(no file)'
    const relative = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file

    console.log(`  ${relative}${importersNote(relative, parents)}`)
    console.log(`    ${error.message}`)
  }
}

function printLeaks(leaks: readonly Leak[]): void {
  const bySource = new Map<string, Set<string>>()

  for (const leak of leaks) {
    const found = bySource.get(leak.source) ?? new Set<string>()

    found.add(leak.what)
    bySource.set(leak.source, found)
  }

  if (bySource.size === 0) {
    return
  }

  console.log()
  console.log(`Denied imports in ${bySource.size} source file(s):`)

  for (const source of [...bySource.keys()].sort()) {
    console.log(`  ${source}`)

    for (const what of [...(bySource.get(source) ?? [])].sort()) {
      console.log(`    ${what}`)
    }
  }
}

async function leaksOf(metafile: Bun.BuildMetafile, parents: Parents): Promise<readonly Leak[]> {
  const leaks: Leak[] = []

  for (const [file, input] of Object.entries(metafile.inputs)) {
    for (const imported of input.imports) {
      if (imported.external !== true) {
        continue
      }

      for (const source of sourcesOf(file, parents)) {
        const what = deniedImport(imported.path, source)

        if (what !== undefined) {
          leaks.push({ source, what: file === source ? what : `${what} (via ${packageOf(file)})` })
        }
      }
    }
  }

  const sources = Object.keys(metafile.inputs).filter(
    (file) => file.startsWith(SRC_PREFIX) && file.endsWith(SOURCE_SUFFIX)
  )

  return [...leaks, ...(await hostGlobalReferences(sources))]
}

function deniedImport(specifier: string, source: string): string | undefined {
  const name = specifier.startsWith(NODE_PREFIX) ? specifier.slice(NODE_PREFIX.length) : specifier
  const root = name.split('/')[0] ?? name

  if (specifier.startsWith(BUN_PREFIX) || specifier === BUN_MODULE || DENIED_MODULES.has(root)) {
    return specifier
  }

  if (root === CRYPTO_MODULE && !source.startsWith(CRYPTO_ALLOWED_PREFIX)) {
    return specifier
  }

  return undefined
}

// Importers of each import target, so a leak inside a package is charged to the source file that
// pulled the package in. A dynamic import Bun leaves out of the inputs still has its importers.
function parentsOf(metafile: Bun.BuildMetafile): Parents {
  const parents = new Map<string, string[]>()

  for (const [file, input] of Object.entries(metafile.inputs)) {
    for (const imported of input.imports) {
      if (imported.external !== true) {
        parents.set(imported.path, [...(parents.get(imported.path) ?? []), file])
      }
    }
  }

  return parents
}

// A build error inside a package names the package file; the sources behind it are the importers
// of any file of that package.
function importersNote(file: string, parents: Parents): string {
  if (file.startsWith(SRC_PREFIX) || !file.includes(PACKAGES_DIR)) {
    return ''
  }

  const packageDir = `${PACKAGES_DIR}${packageOf(file)}/`
  const roots = [...parents.keys()].filter((key) => key.startsWith(packageDir))
  const sources = new Set(roots.flatMap((root) => sourcesOf(root, parents)))

  return sources.size === 0 ? '' : ` (via ${[...sources].sort().join(', ')})`
}

function packageOf(file: string): string {
  const at = file.lastIndexOf(PACKAGES_DIR)

  if (at < 0) {
    return file
  }

  const parts = file.slice(at + PACKAGES_DIR.length).split('/')

  return parts[0]?.startsWith('@') === true ? parts.slice(0, 2).join('/') : (parts[0] ?? file)
}

function sourcesOf(file: string, parents: Parents): string[] {
  const found = new Set<string>()
  const seen = new Set<string>([file])
  const queue = [file]

  for (const current of queue) {
    if (current.startsWith(SRC_PREFIX)) {
      found.add(current)

      continue
    }

    for (const parent of parents.get(current) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent)
        queue.push(parent)
      }
    }
  }

  return [...found]
}

function isOwnTimerMethod(name: string, source: string): boolean {
  return TIMER_METHODS.has(name) && source === TIMER_METHOD_OWNER
}

async function hostGlobalReferences(sources: readonly string[]): Promise<readonly Leak[]> {
  const found = await Promise.all(
    sources.map(async (source) => {
      const lines = (await Bun.file(resolve(ROOT, source)).text()).split('\n')

      return lines.flatMap((line, index) =>
        COMMENT_LINE_RE.test(line)
          ? []
          : [...HOST_GLOBAL_RES].flatMap(([name, re]) =>
              re.test(line) && !isOwnTimerMethod(name, source)
                ? [{ source, what: `${name} (line ${index + 1})` }]
                : []
            )
      )
    })
  )

  return found.flat()
}
