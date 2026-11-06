#!/usr/bin/env bun
// The phone brief app: dist/brief holds the page, its hashed assets, the words (`strings.json`),
// the manifest and icons, the service worker at the root and the `_headers` file. Cloudflare serves
// it as static assets beside the Worker that answers `/api/*`. The service worker is built last,
// because it lists every file the others wrote and a digest of them, so a change to any file
// replaces it. The page's title is the brand's display name.
// `--brief-url=<https url>` (this app's own address) and `--app-url=<https url>` (the web app the
// footer links to) are required; `--noindex` is the staging flag, and while the trial is invite
// only the build is noindex whatever the flag says. The last file written is the build stamp
// (`dist/brief.stamp.json`, outside the served folder) that `scripts/deploy.ts` checks the deploy
// target against.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { BRAND } from '@/core/brand'

import { BRIEF_INVITE_ONLY } from './brief-invite'
import { writeBriefStrings } from './brief-strings'
import { buildBrowser } from './browser-build'
import {
  HEADERS_FILE,
  outDirOf,
  PAGE_FILE,
  parseHttpsUrl,
  resetOutput,
  writeStamp,
} from './web-files'
import { ANALYTICS_HOSTS, buildHeadersFile, LOCKED_DIRECTIVES } from './web-headers'
import { stampInstallTags, writeInstallFiles } from './web-manifest'

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = outDirOf('brief')
const PAGE_ENTRY = resolve(ROOT, 'src/web/brief/index.html')
const SERVICE_WORKER_ENTRY = resolve(ROOT, 'src/web/brief/service-worker.ts')
const BRAND_PLACEHOLDER = '{{brand}}'
const APP_ROOT = '/'
const DIGEST_LENGTH = 16

const { values } = parseArgs({
  options: {
    'brief-url': { type: 'string' },
    'app-url': { type: 'string' },
    noindex: { type: 'boolean' },
  },
})
const briefUrl = parseHttpsUrl(
  values['brief-url'],
  'build-brief: pass --brief-url=<https address of the brief app>'
)
const appUrl = parseHttpsUrl(
  values['app-url'],
  'build-brief: pass --app-url=<https address of the web app>'
)
const noindex = BRIEF_INVITE_ONLY || values.noindex === true

await resetOutput('brief')
await buildEntry(PAGE_ENTRY, { APP_URL: JSON.stringify(appUrl) })
await stampPage(resolve(OUT_DIR, PAGE_FILE))
await writeBriefStrings(OUT_DIR)
await writeInstallFiles(OUT_DIR, {
  id: APP_ROOT,
  startUrl: APP_ROOT,
  scope: APP_ROOT,
  name: BRAND.display,
})

const precache = await listPrecache()

await buildEntry(SERVICE_WORKER_ENTRY, {
  PRECACHE_URLS: JSON.stringify(precache.urls),
  BUILD_ID: JSON.stringify(precache.digest),
})
await Bun.write(resolve(OUT_DIR, HEADERS_FILE), buildHeadersFile(pageDirectives(), { noindex }))
await writeStamp('brief', { url: briefUrl, appUrl, noindex })

console.log(`build-brief: wrote ${OUT_DIR}${noindex ? ' (noindex)' : ''}`)

// Style stays same-origin only; the page draws its share card on a canvas and downloads it from a
// `blob:` address. The one script address Trusted Types lets through is the service worker's. The
// analytics beacon is a parser-inserted script, which Trusted Types leaves alone.
function pageDirectives(): readonly string[] {
  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_HOSTS.script}`,
    "require-trusted-types-for 'script'",
    'trusted-types default',
    "manifest-src 'self'",
    "worker-src 'self'",
    `connect-src 'self' ${ANALYTICS_HOSTS.connect}`,
    "img-src 'self' data: blob:",
    "style-src 'self'",
    ...LOCKED_DIRECTIVES,
  ]
}

async function buildEntry(entry: string, define: Record<string, string>): Promise<void> {
  const build = await buildBrowser({ entry, outdir: OUT_DIR, minify: true, define })

  if (!build.success) {
    for (const log of build.logs) {
      console.error(String(log))
    }

    throw new Error(`build failed: ${entry}`)
  }
}

async function stampPage(file: string): Promise<void> {
  const html = await Bun.file(file).text()

  if (!html.includes(BRAND_PLACEHOLDER)) {
    throw new Error(`build-brief: ${file} has no ${BRAND_PLACEHOLDER} to stamp`)
  }

  await Bun.write(file, stampInstallTags(html.replaceAll(BRAND_PLACEHOLDER, BRAND.display)))
}

interface Precache {
  readonly urls: readonly string[]
  /** Of every listed file's name and bytes: a file that changes without changing its name still
   *  changes the service worker, so an installed app takes it. */
  readonly digest: string
}

// Every file written so far is the app shell. The page answers at the root.
async function listPrecache(): Promise<Precache> {
  const files = (await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: OUT_DIR }))).sort()
  const hasher = new Bun.CryptoHasher('sha256')

  for (const file of files) {
    hasher.update(file)
    hasher.update(await Bun.file(resolve(OUT_DIR, file)).bytes())
  }

  return {
    urls: files.map((file) => (file === PAGE_FILE ? APP_ROOT : `${APP_ROOT}${file}`)),
    digest: hasher.digest('hex').slice(0, DIGEST_LENGTH),
  }
}
