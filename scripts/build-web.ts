#!/usr/bin/env bun
// Static web edition: dist/web holds the page, its hashed assets, the engine worker under a stable
// name, the SQLite wasm beside it and the `_headers` file. Cloudflare serves it as static assets;
// nothing here runs on a server. The page's title is the brand's display name, written here so the
// name has one source, and the link preview tags are added from it and the page's description.
// `--app-url=<https url>` (this page's own address) is required; `--noindex` is the staging flag.
// `--brief-url=<https url>` (the phone brief app) is stamped into a `brief-url` meta only once the
// app is no longer invite only (`BRIEF_INVITE_ONLY`); until then the build carries no address and
// the flag is ignored, but it is required the moment the trial lifts.
// The last file written is the build stamp (`dist/web.stamp.json`, outside the served folder) that
// `scripts/deploy.ts` checks the deploy target against.
import { cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { listBrowserHosts } from '@/app/browser/hosts'

import { BRIEF_INVITE_ONLY } from './brief-invite'
import { buildOrThrow, insertInHead, stampBrand } from './browser-build'
import { PREVIEW_IMAGE_FILE, PREVIEW_IMAGE_SOURCE, stampLinkPreview } from './link-preview'
import {
  HEADERS_FILE,
  outDirOf,
  PAGE_FILE,
  parseHttpsUrl,
  resetOutput,
  writeStamp,
} from './web-files'
import { ANALYTICS_HOSTS, buildHeadersFile, LOCKED_DIRECTIVES } from './web-headers'

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = outDirOf('web')
const PAGE_ENTRY = resolve(ROOT, 'src/web/edition/index.html')
const WORKER_ENTRY = resolve(ROOT, 'src/app/browser/worker.ts')
const WASM_SOURCE = resolve(ROOT, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm')
const WASM_FILE = 'sqlite3.wasm'

const { values } = parseArgs({
  options: {
    'app-url': { type: 'string' },
    'brief-url': { type: 'string' },
    noindex: { type: 'boolean' },
  },
})
const appUrl = parseHttpsUrl(
  values['app-url'],
  'build-web: pass --app-url=<https address of the web app>'
)
const briefUrl = BRIEF_INVITE_ONLY
  ? undefined
  : parseHttpsUrl(
      values['brief-url'],
      'build-web: pass --brief-url=<https address of the brief app>'
    )
const noindex = values.noindex === true

await resetOutput('web')
await buildOrThrow({ entry: PAGE_ENTRY, outdir: OUT_DIR, minify: true })
await stampPage(resolve(OUT_DIR, PAGE_FILE), appUrl, briefUrl)
await buildOrThrow({
  entry: WORKER_ENTRY,
  outdir: OUT_DIR,
  minify: true,
  define: { APP_URL: JSON.stringify(appUrl) },
})
await cp(WASM_SOURCE, resolve(OUT_DIR, WASM_FILE))
await cp(PREVIEW_IMAGE_SOURCE, resolve(OUT_DIR, PREVIEW_IMAGE_FILE))
await Bun.write(
  resolve(OUT_DIR, HEADERS_FILE),
  buildHeadersFile(pageDirectives(listBrowserHosts()), { noindex })
)
await writeStamp('web', { url: appUrl, appUrl, noindex })

console.log(`build-web: wrote ${OUT_DIR}`)

// Style stays same-origin only: the page sets styles through the style object, which the policy
// allows. `data:` and `blob:` images are the inline icons and the tab icon the page draws. The
// analytics beacon is a parser-inserted script, which Trusted Types leaves alone.
function pageDirectives(hosts: readonly string[]): readonly string[] {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${ANALYTICS_HOSTS.script}`,
    "require-trusted-types-for 'script'",
    'trusted-types default',
    "worker-src 'self'",
    `connect-src 'self' ${ANALYTICS_HOSTS.connect} ${hosts.map((host) => `https://${host}`).join(' ')}`,
    "img-src 'self' data: blob:",
    "style-src 'self'",
    ...LOCKED_DIRECTIVES,
  ]
}

async function stampPage(
  file: string,
  pageUrl: string,
  briefUrl: string | undefined
): Promise<void> {
  const html = stampLinkPreview(stampBrand(await Bun.file(file).text(), file), pageUrl)

  await Bun.write(
    file,
    briefUrl === undefined
      ? html
      : insertInHead(html, [`<meta name="brief-url" content="${briefUrl}" />`])
  )
}
