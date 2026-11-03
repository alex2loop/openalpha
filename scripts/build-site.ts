#!/usr/bin/env bun
// Homepage: dist/site is the static `site/` folder with the link to the web app filled in and a
// `_headers` file. `--app-url=<https url>` is required, so the placeholder never ships;
// `--noindex` is the staging flag.
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { buildHeadersFile, LOCKED_DIRECTIVES } from './web-headers'

const ROOT = resolve(import.meta.dir, '..')
const SOURCE_DIR = resolve(ROOT, 'site')
const OUT_DIR = resolve(ROOT, 'dist/site')
const PAGE_FILE = 'index.html'
const HEADERS_FILE = '_headers'
const APP_PLACEHOLDER = 'https://example.com/'
const HTTPS_PROTOCOL = 'https:'
// An inline script or style block, matched the way the HTML parser ends it: at the first closing
// tag.
const INLINE_BLOCK_RE = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g
const SCRIPT_SRC_RE = /\bsrc\s*=/

const { values } = parseArgs({
  options: { 'app-url': { type: 'string' }, noindex: { type: 'boolean' } },
})

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
await cp(SOURCE_DIR, OUT_DIR, { recursive: true })

const page = (await Bun.file(resolve(SOURCE_DIR, PAGE_FILE)).text()).replaceAll(
  APP_PLACEHOLDER,
  parseAppUrl(values['app-url'])
)

await Bun.write(resolve(OUT_DIR, PAGE_FILE), page)
await Bun.write(
  resolve(OUT_DIR, HEADERS_FILE),
  buildHeadersFile(siteDirectives(page), { noindex: values.noindex === true })
)

console.log(`build-site: wrote ${OUT_DIR}`)

function parseAppUrl(raw: string | undefined): string {
  const url = raw === undefined || !URL.canParse(raw) ? undefined : new URL(raw)

  if (url?.protocol !== HTTPS_PROTOCOL) {
    throw new Error('build-site: pass --app-url=<https address of the web app>')
  }

  return url.href
}

// The page carries its own scripts and styles inline, so each block is allowed by its hash and the
// policy stays closed to any other inline code. Style attributes cannot be hashed without
// `unsafe-hashes`, so they are allowed as a group: they set custom properties and nothing runs.
function siteDirectives(html: string): readonly string[] {
  const scripts = inlineHashes(html, 'script')
  const styles = inlineHashes(html, 'style')

  return [
    "default-src 'self'",
    `script-src 'self' ${scripts.join(' ')}`,
    `style-src 'self' ${styles.join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    ...LOCKED_DIRECTIVES,
  ]
}

function inlineHashes(html: string, tag: 'script' | 'style'): readonly string[] {
  const hashes = [...html.matchAll(INLINE_BLOCK_RE)]
    .filter(([, name, attrs]) => name === tag && !SCRIPT_SRC_RE.test(attrs ?? ''))
    .map(([, , , body]) => {
      const digest = new Bun.CryptoHasher('sha256').update(body ?? '').digest('base64')

      return `'sha256-${digest}'`
    })

  return [...new Set(hashes)]
}
