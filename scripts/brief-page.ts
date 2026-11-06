import { resolve } from 'node:path'

import { BRAND } from '@/core/brand'
import { CLOUDFLARE_POLICY_URL, maintainerOf } from '@/web/edition/legal/legal-links'

import { buildBriefStrings } from './brief-strings'
import { type BrowserBuild, buildOrThrow } from './browser-build'

const ROOT = resolve(import.meta.dir, '..')
const PAGE_ENTRY = resolve(ROOT, 'src/web/brief/index.html')

const PRIVACY_PARAMS = {
  brand: BRAND.display,
  maintainer: maintainerOf(BRAND.repository),
  repoUrl: BRAND.repository,
  cloudflarePolicyUrl: CLOUDFLARE_POLICY_URL,
}

/** The phone app's page, minified with its words, its privacy names and the web app's address
 *  built in. */
export function buildBriefPage(outdir: string, appUrl: string): Promise<BrowserBuild> {
  return buildOrThrow({
    entry: PAGE_ENTRY,
    outdir,
    minify: true,
    define: {
      APP_URL: JSON.stringify(appUrl),
      STRINGS: JSON.stringify(buildBriefStrings()),
      PRIVACY_PARAMS: JSON.stringify(PRIVACY_PARAMS),
    },
  })
}
