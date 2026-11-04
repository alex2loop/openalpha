#!/usr/bin/env bun
// After a deploy: every file of a built folder must be served byte for byte at the address, and the
// `/*` headers of its `_headers` must be on the page. A difference means what visitors get is not
// what was built. `--dist=<built folder> --url=<https address>`; exits 1 on any difference.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const HEADERS_FILE = '_headers'
const INDEX_FILE = 'index.html'
const HTTPS_PROTOCOL = 'https:'
const ALL_PATHS_RULE = '/*'
const HEADER_LINE_RE = /^\s+([A-Za-z-]+):\s*(.+)$/
// A fresh deploy can take a moment to reach every edge.
const ATTEMPTS = 6
const RETRY_MS = 10_000

const { values } = parseArgs({ options: { dist: { type: 'string' }, url: { type: 'string' } } })
const distDir = resolve(parseRequired(values.dist, '--dist=<built folder>'))
const baseUrl = parseBaseUrl(values.url)
const files = await listServedFiles(distDir)
const headers = await readPageHeaders(distDir)

for (let attempt = 1; ; attempt++) {
  const drift = [...(await fileDrift(files, distDir)), ...(await headerDrift(headers))]

  if (drift.length === 0) {
    console.log(`deploy-drift: ${files.length} files and ${headers.size} headers match ${baseUrl}`)
    break
  }

  if (attempt >= ATTEMPTS) {
    console.error(`deploy-drift: ${baseUrl} differs from ${distDir}:\n  ${drift.join('\n  ')}`)
    process.exitCode = 1
    break
  }

  await Bun.sleep(RETRY_MS)
}

function parseRequired(raw: string | undefined, usage: string): string {
  if (raw === undefined || raw === '') {
    throw new Error(`deploy-drift: pass ${usage}`)
  }

  return raw
}

function parseBaseUrl(raw: string | undefined): string {
  const href = parseRequired(raw, '--url=<https address>')
  const url = URL.canParse(href) ? new URL(href) : undefined

  if (url?.protocol !== HTTPS_PROTOCOL) {
    throw new Error('deploy-drift: --url must be an https address')
  }

  return url.href
}

async function listServedFiles(dir: string): Promise<readonly string[]> {
  const names = await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: dir, onlyFiles: true }))

  return names.filter((name) => name !== HEADERS_FILE).sort()
}

// The rule for every path, as name (lower case) to value.
async function readPageHeaders(dir: string): Promise<ReadonlyMap<string, string>> {
  const lines = (await Bun.file(resolve(dir, HEADERS_FILE)).text()).split('\n')
  const start = lines.indexOf(ALL_PATHS_RULE)
  const headers = new Map<string, string>()

  for (const line of lines.slice(start + 1)) {
    const match = HEADER_LINE_RE.exec(line)

    if (match === null) {
      break
    }

    headers.set(match[1].toLowerCase(), match[2].trim())
  }

  return headers
}

async function fileDrift(files: readonly string[], dir: string): Promise<readonly string[]> {
  const drift: string[] = []

  for (const name of files) {
    const response = await fetch(new URL(toServedPath(name), baseUrl))
    const served = response.ok ? sha256(await response.arrayBuffer()) : `HTTP ${response.status}`
    const built = sha256(await Bun.file(resolve(dir, name)).arrayBuffer())

    if (served !== built) {
      drift.push(`${name}: built ${built}, served ${served}`)
    }
  }

  return drift
}

// The assets server answers a folder's page at the folder, not at index.html.
function toServedPath(name: string): string {
  return name === INDEX_FILE || name.endsWith(`/${INDEX_FILE}`)
    ? name.slice(0, -INDEX_FILE.length)
    : name
}

async function headerDrift(expected: ReadonlyMap<string, string>): Promise<readonly string[]> {
  const response = await fetch(baseUrl, { method: 'HEAD' })
  const drift: string[] = []

  for (const [name, value] of expected) {
    const served = response.headers.get(name)

    if (served !== value) {
      drift.push(`header ${name}: built "${value}", served "${served ?? 'absent'}"`)
    }
  }

  return drift
}

function sha256(bytes: ArrayBuffer): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}
