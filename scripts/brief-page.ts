import { resolve } from 'node:path'

import { type BrowserBuild, buildOrThrow } from './browser-build'
import { buildBriefStrings } from './brief-strings'

const ROOT = resolve(import.meta.dir, '..')
const PAGE_ENTRY = resolve(ROOT, 'src/web/brief/index.html')

/** The phone app's page, minified with its words and the web app's address built in. */
export function buildBriefPage(outdir: string, appUrl: string): Promise<BrowserBuild> {
  return buildOrThrow({
    entry: PAGE_ENTRY,
    outdir,
    minify: true,
    define: { APP_URL: JSON.stringify(appUrl), STRINGS: JSON.stringify(buildBriefStrings()) },
  })
}
