#!/usr/bin/env bun
// Static web edition: dist/web holds the page, its hashed assets, the engine worker under a stable
// name, the SQLite wasm beside it and the `_headers` file. Cloudflare serves it as static assets;
// nothing here runs on a server. The page's title is the brand's display name, written here so the
// name has one source, and the link preview tags are added from it and the page's description.
// `--app-url=<https url>` (this page's own address) is required; `--noindex` is the staging flag.
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { listBrowserHosts } from '@/app/browser/hosts'
import { BRAND } from '@/core/brand'

import { buildBrowser } from './browser-build'
import {
  PREVIEW_IMAGE_FILE,
  PREVIEW_IMAGE_SOURCE,
  parseHttpsUrl,
  stampLinkPreview,
} from './link-preview'
import { buildHeadersFile, LOCKED_DIRECTIVES } from './web-headers'

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = resolve(ROOT, 'dist/web')
const PAGE_ENTRY = resolve(ROOT, 'src/web/edition/index.html')
const WORKER_ENTRY = resolve(ROOT, 'src/app/browser/worker.ts')
const WASM_SOURCE = resolve(ROOT, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm')
const WASM_FILE = 'sqlite3.wasm'
const HEADERS_FILE = '_headers'
const PAGE_FILE = 'index.html'
const BRAND_PLACEHOLDER = '{{brand}}'

const { values } = parseArgs({
  options: { 'app-url': { type: 'string' }, noindex: { type: 'boolean' } },
})
const appUrl = parseHttpsUrl(
  values['app-url'],
  'build-web: pass --app-url=<https address of the web app>'
)

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
await buildEntry(PAGE_ENTRY)
await stampPage(resolve(OUT_DIR, PAGE_FILE), appUrl)
await buildEntry(WORKER_ENTRY)
await cp(WASM_SOURCE, resolve(OUT_DIR, WASM_FILE))
await cp(PREVIEW_IMAGE_SOURCE, resolve(OUT_DIR, PREVIEW_IMAGE_FILE))
await Bun.write(
  resolve(OUT_DIR, HEADERS_FILE),
  buildHeadersFile(pageDirectives(listBrowserHosts()), {
    noindex: values.noindex === true,
  })
)

console.log(`build-web: wrote ${OUT_DIR}`)

// Style stays same-origin only: the page sets styles through the style object, which the policy
// allows. `data:` and `blob:` images are the inline icons and the tab icon the page draws.
function pageDirectives(hosts: readonly string[]): readonly string[] {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "require-trusted-types-for 'script'",
    "worker-src 'self'",
    `connect-src 'self' ${hosts.map((host) => `https://${host}`).join(' ')}`,
    "img-src 'self' data: blob:",
    "style-src 'self'",
    ...LOCKED_DIRECTIVES,
  ]
}

async function buildEntry(entry: string): Promise<void> {
  const build = await buildBrowser({ entry, outdir: OUT_DIR, minify: true })

  if (!build.success) {
    for (const log of build.logs) {
      console.error(String(log))
    }

    throw new Error(`build failed: ${entry}`)
  }
}

async function stampPage(file: string, pageUrl: string): Promise<void> {
  const html = await Bun.file(file).text()

  if (!html.includes(BRAND_PLACEHOLDER)) {
    throw new Error(`build-web: ${file} has no ${BRAND_PLACEHOLDER} to stamp`)
  }

  const branded = html.replaceAll(BRAND_PLACEHOLDER, BRAND.display)

  await Bun.write(file, stampLinkPreview(branded, pageUrl))
}
