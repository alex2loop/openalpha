// What the web builds, the deploy guard and deploy-drift share: the names of the files a static
// site ships, the folder and build stamp of each site, and the https address check for their flags.
// No `@/` imports: the deploy job installs nothing of the app.
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

export const PAGE_FILE = 'index.html'
export const HEADERS_FILE = '_headers'

const ROOT = resolve(import.meta.dir, '..')
const DIST_DIR = resolve(ROOT, 'dist')
const HTTPS_PROTOCOL = 'https:'

export type SiteKind = 'web' | 'site'

/** What a build was made for. The deploy guard refuses a target that disagrees with it. */
export interface BuildStamp {
  /** The page's own address. */
  readonly url: string
  /** The web app's address: the page's own for the app, the link target for the homepage. */
  readonly appUrl: string
  readonly noindex: boolean
}

export function outDirOf(kind: SiteKind): string {
  return resolve(DIST_DIR, kind)
}

/** Empties the built folder and drops its stamp, so a build that fails part way leaves none. */
export async function resetOutput(kind: SiteKind): Promise<void> {
  await rm(outDirOf(kind), { recursive: true, force: true })
  await rm(stampFileOf(kind), { force: true })
  await mkdir(outDirOf(kind), { recursive: true })
}

/** Written last: a stamp means the whole build finished. */
export async function writeStamp(kind: SiteKind, stamp: BuildStamp): Promise<void> {
  await Bun.write(stampFileOf(kind), `${JSON.stringify(stamp, null, 2)}\n`)
}

export async function readStamp(kind: SiteKind): Promise<BuildStamp> {
  const file = Bun.file(stampFileOf(kind))

  if (!(await file.exists())) {
    throw new Error(`no build stamp for ${kind}: run its build first`)
  }

  const stamp: Partial<BuildStamp> = await file.json()

  if (
    typeof stamp.url !== 'string' ||
    typeof stamp.appUrl !== 'string' ||
    typeof stamp.noindex !== 'boolean'
  ) {
    throw new Error(`the ${kind} build stamp is malformed: rebuild it`)
  }

  return { url: stamp.url, appUrl: stamp.appUrl, noindex: stamp.noindex }
}

// Beside the built folder, never inside it: the stamp is not an asset and nothing serves it.
function stampFileOf(kind: SiteKind): string {
  return resolve(DIST_DIR, `${kind}.stamp.json`)
}


export function parseHttpsUrl(raw: string | undefined, failure: string): string {
  const url = raw === undefined || !URL.canParse(raw) ? undefined : new URL(raw)

  if (url?.protocol !== HTTPS_PROTOCOL) {
    throw new Error(failure)
  }

  return url.href
}
