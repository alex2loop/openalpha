#!/usr/bin/env bun
// The phone brief app: dist/brief holds the page with its words built in, its hashed assets, the
// manifest and icons, the service worker at the root and the `_headers` file. Cloudflare serves it
// as static assets beside the Worker that answers `/api/*`. The service worker is built last,
// because it lists every file the others wrote and a digest of them, so a change to any file
// replaces it. The page's title is the brand's display name.
// `--brief-url=<https url>` (this app's own address) and `--app-url=<https url>` (the web app the
// footer links to) are required; `--noindex` is the staging flag, and while the trial is invite
// only the build is noindex whatever the flag says. The page's bundle must pass
// `check-brief-bundle` or the build stops. The last file written is the build stamp
// (`dist/brief.stamp.json`, outside the served folder) that `scripts/deploy.ts` checks the deploy
// target against.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { BRAND } from '@/core/brand'

import { BRIEF_INVITE_ONLY } from './brief-invite'
import { buildBriefPage } from './brief-page'
import { buildOrThrow, stampBrand } from './browser-build'
import { assertBriefBundle, gzipBytesOf } from './check-brief-bundle'
import {
  HEADERS_FILE,
  outDirOf,
  PAGE_FILE,
  parseHttpsUrl,
  resetOutput,
  writeStamp,
} from './web-files'
import { buildHeadersFile, LOCKED_DIRECTIVES } from './web-headers'
import { stampInstallTags, writeInstallFiles } from './web-manifest'

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = outDirOf('brief')
const SERVICE_WORKER_ENTRY = resolve(ROOT, 'src/web/brief/service-worker.ts')
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
const page = await buildBriefPage(OUT_DIR, appUrl)

if (page.metafile === undefined) {
  throw new Error('build-brief: the page build wrote no metafile')
}

assertBriefBundle(page.metafile, await gzipBytesOf(page.outputs))

await stampPage(resolve(OUT_DIR, PAGE_FILE))
await writeInstallFiles(OUT_DIR, {
  id: APP_ROOT,
  startUrl: APP_ROOT,
  scope: APP_ROOT,
  name: BRAND.display,
})

const precache = await listPrecache()

await buildOrThrow({
  entry: SERVICE_WORKER_ENTRY,
  outdir: OUT_DIR,
  minify: true,
  define: { PRECACHE_URLS: JSON.stringify(precache.urls), BUILD_ID: JSON.stringify(precache.digest) },
})
await Bun.write(resolve(OUT_DIR, HEADERS_FILE), buildHeadersFile(pageDirectives(), { noindex }))
await writeStamp('brief', { url: briefUrl, appUrl, noindex })

console.log(`build-brief: wrote ${OUT_DIR}${noindex ? ' (noindex)' : ''}`)

// Style stays same-origin only; the page draws its share card on a canvas and downloads it from a
// `blob:` address. The one script address Trusted Types lets through is the service worker's. The
// page loads no analytics, as its privacy page says.
function pageDirectives(): readonly string[] {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "require-trusted-types-for 'script'",
    'trusted-types default',
    "manifest-src 'self'",
    "worker-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self'",
    ...LOCKED_DIRECTIVES,
  ]
}

async function stampPage(file: string): Promise<void> {
  const html = await Bun.file(file).text()

  await Bun.write(file, stampInstallTags(stampBrand(html, file)))
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
