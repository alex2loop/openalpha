import type { HTMLBundle } from 'bun'
import { dirname, relative, sep } from 'node:path'

import { officePage } from '@/web/api'

const PAGE_PATH = '/'
const URL_SEPARATOR = '/'
/** Sent with every built page file. A source run cannot send them; the page's frame guard covers
 *  framing there. */
const PAGE_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://api.open-meteo.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
})

type BuiltFile = NonNullable<HTMLBundle['files']>[number]

/** A compiled binary carries the built page, so the daemon serves it from `fetch`, behind its own
 *  Host check. A source run has Bun bundle the page on request, which only a `routes` entry can
 *  do, so there the page answers before that check (it holds no data). */
const BUILT_FILES: ReadonlyMap<string, BuiltFile> = toServedFiles(officePage)

export const PAGE_ROUTES: Readonly<Record<string, HTMLBundle>> =
  BUILT_FILES.size === 0 ? { [PAGE_PATH]: officePage } : {}

/** The built page file at `pathname`, or `undefined` when it is not one. */
export function toPageResponse(req: Request, pathname: string): Response | undefined {
  const file = req.method === 'GET' || req.method === 'HEAD' ? BUILT_FILES.get(pathname) : undefined

  return file === undefined
    ? undefined
    : new Response(Bun.file(file.path), {
        headers: { ...file.headers, ...PAGE_SECURITY_HEADERS },
      })
}

// Served at its path beside the page, the way the built HTML names it; the page itself at `/`.
function toServedFiles(page: HTMLBundle): ReadonlyMap<string, BuiltFile> {
  const root = dirname(page.index)

  return new Map(
    (page.files ?? []).map((file) => [
      file.path === page.index
        ? PAGE_PATH
        : `${URL_SEPARATOR}${relative(root, file.path).split(sep).join(URL_SEPARATOR)}`,
      file,
    ])
  )
}
