import { resolve } from 'node:path'

import { BRAND } from '@/core/brand'
import { CLOUDFLARE_POLICY_URL, maintainerOf } from '@/web/edition/legal/legal-links'

import { buildBriefStrings } from './brief-strings'
import { type BrowserBuild, buildOrThrow } from './browser-build'

const ROOT = resolve(import.meta.dir, '..')
const PAGE_ENTRY = resolve(ROOT, 'src/web/brief/index.html')
const SERVICE_WORKER_ENTRY = resolve(ROOT, 'src/web/brief/service-worker.ts')

const PUSH_KEY_PREFIX = 'brief.push.'

const PRIVACY_PARAMS = {
  brand: BRAND.display,
  maintainer: maintainerOf(BRAND.repository),
  repoUrl: BRAND.repository,
  cloudflarePolicyUrl: CLOUDFLARE_POLICY_URL,
}

export interface Precache {
  /** The address of every file of the app shell. */
  readonly urls: readonly string[]
  /** Of every listed file's name and bytes: a file that changes without changing its name still
   *  changes the service worker, so an installed app takes it. */
  readonly digest: string
}

export interface PageStamps {
  /** The address of the web app the footer links to. */
  readonly appUrl: string
  /** The Worker's public VAPID key; empty builds the app without a reminder. */
  readonly vapidPublicKey: string
}

/** The phone app's page, minified with its words, its privacy names, the web app's address and the
 *  reminder's key built in. */
export function buildBriefPage(outdir: string, stamps: PageStamps): Promise<BrowserBuild> {
  return buildOrThrow({
    entry: PAGE_ENTRY,
    outdir,
    minify: true,
    define: {
      APP_URL: JSON.stringify(stamps.appUrl),
      VAPID_PUBLIC_KEY: JSON.stringify(stamps.vapidPublicKey),
      STRINGS: JSON.stringify(buildBriefStrings()),
      PRIVACY_PARAMS: JSON.stringify(PRIVACY_PARAMS),
    },
  })
}

/** The phone app's service worker, minified, with the shell it keeps, the build's digest and the
 *  words of its notification. */
export function buildBriefWorker(outdir: string, precache: Precache): Promise<BrowserBuild> {
  return buildOrThrow({
    entry: SERVICE_WORKER_ENTRY,
    outdir,
    minify: true,
    define: {
      PRECACHE_URLS: JSON.stringify(precache.urls),
      BUILD_ID: JSON.stringify(precache.digest),
      PUSH_STRINGS: JSON.stringify(buildBriefStrings(PUSH_KEY_PREFIX)),
    },
  })
}
