#!/usr/bin/env bun
// After a deploy: every file of a built folder must be served byte for byte at the address, and the
// `/*` headers of its `_headers` must be on the page. A difference means what visitors get is not
// what was built. `--dist=<built folder> --url=<https address>`; exits 1 on any difference.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { HEADERS_FILE, PAGE_FILE, parseHttpsUrl } from './web-files'

const ALL_PATHS_RULE = '/*'
const HEADER_LINE_RE = /^\s+([A-Za-z-]+):\s*(.+)$/
// A fresh deploy can take a moment to reach every edge.
const ATTEMPTS = 6
const RETRY_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000

const { values } = parseArgs({ options: { dist: { type: 'string' }, url: { type: 'string' } } })
const distDir = resolve(parseRequired(values.dist, '--dist=<built folder>'))
const baseUrl = parseHttpsUrl(values.url, 'deploy-drift: pass --url=<https address>')
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

  if (headers.size === 0) {
    throw new Error(`deploy-drift: ${HEADERS_FILE} has no ${ALL_PATHS_RULE} rule with headers`)
  }

  return headers
}

async function fileDrift(files: readonly string[], dir: string): Promise<readonly string[]> {
  const drift: string[] = []

  for (const name of files) {
    const served = await fetchServed(new URL(toServedPath(name), baseUrl))
    const built = sha256(await Bun.file(resolve(dir, name)).arrayBuffer())

    if (served !== built) {
      drift.push(`${name}: built ${built}, served ${served}`)
    }
  }

  return drift
}

// What the address serves for a file: its hash, or why there is none.
async function fetchServed(url: URL): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

    return response.ok ? sha256(await response.arrayBuffer()) : `HTTP ${response.status}`
  } catch (err) {
    return `request failed (${describeError(err)})`
  }
}

// The assets server answers a folder's page at the folder, not at index.html.
function toServedPath(name: string): string {
  return name === PAGE_FILE || name.endsWith(`/${PAGE_FILE}`)
    ? name.slice(0, -PAGE_FILE.length)
    : name
}

async function headerDrift(expected: ReadonlyMap<string, string>): Promise<readonly string[]> {
  let response: Response

  try {
    response = await fetch(baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    return [`headers: request failed (${describeError(err)})`]
  }

  const drift: string[] = []

  for (const [name, value] of expected) {
    const served = response.headers.get(name)

    if (served !== value) {
      drift.push(`header ${name}: built "${value}", served "${served ?? 'absent'}"`)
    }
  }

  return drift
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sha256(bytes: ArrayBuffer): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}
