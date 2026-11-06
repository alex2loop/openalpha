#!/usr/bin/env bun
// Homepage: dist/site is the static `site/` folder with the link to the web app filled in, the link
// preview tags, the one vendored script (copied from the locked `motion` package, so its integrity
// is the lockfile's) and a `_headers` file. `--app-url=<https url>` (the web app) and
// `--site-url=<https url>` (this page, for the link preview) are required, so the placeholder never
// ships; `--noindex` is the staging flag. The last file written is the build stamp
// (`dist/site.stamp.json`, outside the served folder) that `scripts/deploy.ts` checks the deploy
// target against.
import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { stampLinkPreview } from './link-preview'
import { ANALYTICS_HOSTS, buildHeadersFile, LOCKED_DIRECTIVES } from './web-headers'
import {
  HEADERS_FILE,
  outDirOf,
  PAGE_FILE,
  parseHttpsUrl,
  resetOutput,
  writeStamp,
} from './web-files'

const ROOT = resolve(import.meta.dir, '..')
const SOURCE_DIR = resolve(ROOT, 'site')
const OUT_DIR = outDirOf('site')
const MOTION_DIR = resolve(ROOT, 'node_modules/motion')
const MOTION_SCRIPT = 'dist/motion.js'
const MOTION_LICENSE = 'LICENSE.md'
const VENDOR_DIR = 'vendor'
const APP_PLACEHOLDER = 'https://example.com/'
// An inline script or style block, matched the way the HTML parser ends it: at the first closing
// tag.
const INLINE_BLOCK_RE = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g
const SCRIPT_SRC_RE = /\bsrc\s*=/

const { values } = parseArgs({
  options: {
    'app-url': { type: 'string' },
    'site-url': { type: 'string' },
    noindex: { type: 'boolean' },
  },
})
const appUrl = parseHttpsUrl(
  values['app-url'],
  'build-site: pass --app-url=<https address of the web app>'
)
const siteUrl = parseHttpsUrl(
  values['site-url'],
  'build-site: pass --site-url=<https address of this homepage>'
)

const noindex = values.noindex === true

await resetOutput('site')
await cp(SOURCE_DIR, OUT_DIR, { recursive: true })

const page = stampLinkPreview(
  (await Bun.file(resolve(SOURCE_DIR, PAGE_FILE)).text()).replaceAll(APP_PLACEHOLDER, appUrl),
  siteUrl
)

await vendorMotion(page)
await Bun.write(resolve(OUT_DIR, PAGE_FILE), page)
await Bun.write(
  resolve(OUT_DIR, HEADERS_FILE),
  buildHeadersFile(siteDirectives(page), { noindex })
)
await writeStamp('site', { url: siteUrl, appUrl, noindex })

console.log(`build-site: wrote ${OUT_DIR}`)

// The page names the file it loads, version included; the package that supplies it must be that
// version, so the pin in the page and the one in the lockfile cannot drift apart.
async function vendorMotion(html: string): Promise<void> {
  const manifest = Bun.file(resolve(MOTION_DIR, 'package.json'))

  if (!(await manifest.exists())) {
    throw new Error('build-site: the motion package is not installed: run bun install')
  }

  const { version } = await manifest.json()
  const name = `motion-${version}.js`

  if (!html.includes(`"${VENDOR_DIR}/${name}"`)) {
    throw new Error(`build-site: the page does not load the installed ${VENDOR_DIR}/${name}`)
  }

  await mkdir(resolve(OUT_DIR, VENDOR_DIR), { recursive: true })
  await cp(resolve(MOTION_DIR, MOTION_SCRIPT), resolve(OUT_DIR, VENDOR_DIR, name))
  await cp(resolve(MOTION_DIR, MOTION_LICENSE), resolve(OUT_DIR, VENDOR_DIR, 'motion-LICENSE.md'))
}

// The page carries its own scripts and styles inline, so each block is allowed by its hash and the
// policy stays closed to any other inline code. Style attributes cannot be hashed without
// `unsafe-hashes`, so they are allowed as a group: they set custom properties and nothing runs.
function siteDirectives(html: string): readonly string[] {
  const scripts = inlineHashes(html, 'script')
  const styles = inlineHashes(html, 'style')

  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_HOSTS.script} ${scripts.join(' ')}`,
    `style-src 'self' ${styles.join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    `connect-src 'self' ${ANALYTICS_HOSTS.connect}`,
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
