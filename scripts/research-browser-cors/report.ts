import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceKind } from '@/trading/kernel/source/source-result'
import { SOURCE_ROUTES, toBrowserRoutes } from '@/trading/sources/routes'
import { BROWSER_REACHABLE_SOURCES } from '@/trading/wiring/composition/source-facts'

import type { Measurement } from './types'
import { credentials } from './capture'
import { PAGE_ORIGIN } from './measure'

const SECRET_MASK = '***'
const ID_WIDTH = 20
const HOST_WIDTH = 34
const CORS_WIDTH = 5
const STATUS_WIDTH = 7
const ALLOW_WIDTH = 28
const PREFLIGHT_WIDTH = 16
const NONE = '-'
const COLUMNS: readonly { readonly title: string; readonly width: number }[] = [
  { title: 'id', width: ID_WIDTH },
  { title: 'origin', width: HOST_WIDTH },
  { title: 'cors', width: CORS_WIDTH },
  { title: 'status', width: STATUS_WIDTH },
  { title: 'allow-origin', width: ALLOW_WIDTH },
  { title: 'preflight', width: PREFLIGHT_WIDTH },
  { title: 'first bytes', width: 0 },
]

/** Whether each provider passed on every origin it was measured against. */
export function passingIds(rows: readonly Measurement[]): ReadonlyMap<SourceId, boolean> {
  const verdicts = new Map<SourceId, boolean>()

  for (const { captured: request, cors } of rows) {
    verdicts.set(request.id, (verdicts.get(request.id) ?? true) && cors)
  }

  return verdicts
}

export function printMeasurements(rows: readonly Measurement[]): void {
  console.log(`CORS measured with Origin ${PAGE_ORIGIN}, ${new Date().toISOString()}`)
  console.log(COLUMNS.map(({ title, width }) => title.padEnd(width)).join(' '))

  for (const row of rows) {
    const { captured: request } = row

    console.log(
      [
        request.id.padEnd(ID_WIDTH),
        new URL(request.url).origin.replace('https://', '').padEnd(HOST_WIDTH),
        (row.cors ? 'PASS' : 'FAIL').padEnd(CORS_WIDTH),
        row.status.padEnd(STATUS_WIDTH),
        row.allowOrigin.padEnd(ALLOW_WIDTH),
        row.preflight.padEnd(PREFLIGHT_WIDTH),
        row.preview,
      ].join(' ')
    )
    console.log(`${' '.repeat(ID_WIDTH)} ${request.cell} ${request.method} ${mask(request.url)}`)
  }
}

export function printNotMeasured(unprobed: readonly string[], needsKey: readonly SourceId[]): void {
  console.log('\nneeds key, not measured:', needsKey.join(', ') || NONE)
  console.log('route cells where no request reached the wire:', unprobed.join(', ') || NONE)
}

export function printVerdict(
  passing: ReadonlyMap<SourceId, boolean>,
  rows: readonly Measurement[]
): void {
  const passed = [...passing].filter(([, ok]) => ok).map(([id]) => id)
  const failed = [...passing].filter(([, ok]) => !ok).map(([id]) => id)
  const partial = failed.filter((id) =>
    rows.some(({ captured: request, cors }) => request.id === id && cors)
  )
  const stale = [...BROWSER_REACHABLE_SOURCES].filter((id) => !passed.includes(id))
  const unlisted = passed.filter((id) => !BROWSER_REACHABLE_SOURCES.has(id))

  console.log('\nreachable (every measured origin passes):', passed.join(', '))
  console.log('blocked or partial:', failed.join(', '))
  console.log('partial (some origins pass):', partial.join(', ') || NONE)
  console.log('in BROWSER_REACHABLE_SOURCES but not passing:', stale.join(', ') || NONE)
  console.log('passing but not in BROWSER_REACHABLE_SOURCES:', unlisted.join(', ') || NONE)
}

export function printRouteTable(): void {
  const browser = toBrowserRoutes(SOURCE_ROUTES, BROWSER_REACHABLE_SOURCES)

  console.log('\nbrowser route table (kind/scope: browser providers | dropped | state)')

  for (const [kind, scopes] of Object.entries(SOURCE_ROUTES)) {
    for (const [scope, ids] of Object.entries(scopes)) {
      // why-safe: the browser table is keyed by the same kinds as SOURCE_ROUTES.
      const kept = browser[kind as SourceKind][scope] ?? []
      const dropped = ids.filter((id) => !kept.includes(id))
      const label = `${kind}/${scope}`.padEnd(ID_WIDTH + HOST_WIDTH)

      console.log(
        `${label} ${kept.join(', ') || NONE} | ${dropped.join(', ') || NONE} | ${routeState(kept, dropped)}`
      )
    }
  }
}

function routeState(kept: readonly string[], dropped: readonly string[]): string {
  if (kept.length === 0) {
    return 'off'
  }

  return dropped.length === 0 ? 'full' : 'reduced'
}

function mask(url: string): string {
  let masked = url

  for (const secret of Object.values(credentials)) {
    masked = secret === undefined ? masked : masked.replaceAll(secret, SECRET_MASK)
  }

  return masked
}
