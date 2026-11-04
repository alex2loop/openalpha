import { type Signal, signal } from '@preact/signals'

import { type Bound, boundId, hasLimits, withinLimits } from '@/web/edition/screen-bounds'
import {
  type BaseSortKey,
  type Candidate,
  NO_SORT,
  resolveSortKey,
  resolveThenKey,
  type SortChoices,
  type SortDirection,
  type SortOrder,
} from '@/web/edition/screen-sort'
import { keyOf } from '@/web/state/market'
import { readStorage, writeStorage } from '@/web/state/storage'

const STORAGE_PREFIX = 'oa.edition.screenView.'
const NO_SECTOR = ''
/** The size fields a view saved before the limits became a table kept at its top level, and the limit
 *  each now is. */
const LEGACY_LIMITS = Object.freeze({
  minTurnover: boundId('turnover', 'min'),
  minMarketCap: boundId('marketCap', 'min'),
  maxMarketCap: boundId('marketCap', 'max'),
})
/** The market's first kind, which the board serves when none is asked. */
export const DEFAULT_KIND = ''

/** Which of the visitor's own names the board shows. */
export type Scope = 'all' | 'held' | 'watched'

/** What the visitor chose for one market's board: the kind of instrument it lists, its order and its
 *  filters. Limits are kept as typed, so a field reads back as the visitor wrote it. */
export interface BoardView {
  readonly kind: string
  readonly sort: string
  readonly direction: SortDirection
  /** The sort that orders names the first one leaves tied; none by default. */
  readonly thenSort: string
  readonly thenDirection: SortDirection
  readonly scope: Scope
  readonly sector: string
  readonly bounds: Readonly<Record<string, string>>
}

/** No filter applied, the most traded names first, as a price board lists them: an order anyone can
 *  check, which says nothing about which name is better. A board without traded value falls back
 *  through `resolveSortKey`. */
const DEFAULT_VIEW: BoardView = Object.freeze({
  kind: DEFAULT_KIND,
  sort: 'turnover' satisfies BaseSortKey,
  direction: 'desc',
  thenSort: NO_SORT,
  thenDirection: 'desc',
  scope: 'all',
  sector: NO_SECTOR,
  bounds: Object.freeze({}),
})

/** The keys of the visitor's own names on this board: `market:ticker`. */
export interface OwnNames {
  readonly held: ReadonlySet<string>
  readonly watched: ReadonlySet<string>
}

// One per market the visitor opened, so bounded by the markets there are.
const views = new Map<string, Signal<BoardView>>()

/** The market's view: what the visitor saved on this browser, else the default. */
export function viewOf(market: string): Signal<BoardView> {
  let view = views.get(market)

  if (view === undefined) {
    view = signal(readView(market))
    views.set(market, view)
  }

  return view
}

/** Changes the market's view and remembers it on this browser. */
export function updateView(market: string, change: Partial<BoardView>): void {
  const view = viewOf(market)

  view.value = { ...view.value, ...change }
  writeStorage('local', `${STORAGE_PREFIX}${market}`, JSON.stringify(view.value))
}

/** Chooses the market's first sort. A second sort the same as it is dropped. */
export function setSort(market: string, sort: string): void {
  const { thenSort } = viewOf(market).value

  updateView(market, { sort, ...(thenSort === sort ? { thenSort: NO_SORT } : {}) })
}

/** The sorts the view asks for, first to last. */
export function sortOrdersOf(view: BoardView): readonly SortOrder[] {
  return [
    { key: view.sort, direction: view.direction },
    ...(view.thenSort === NO_SORT ? [] : [{ key: view.thenSort, direction: view.thenDirection }]),
  ]
}

/** Puts the market's board back on its first kind, for a saved kind the market does not serve. */
export function clearKind(market: string): void {
  updateView(market, { kind: DEFAULT_KIND })
}

/** Drops every filter and keeps the kind and the order. */
export function clearFilters(market: string): void {
  const { kind, sort, direction, thenSort, thenDirection } = viewOf(market).value

  updateView(market, { ...DEFAULT_VIEW, kind, sort, direction, thenSort, thenDirection })
}

export function isFiltered(view: BoardView, bounds: readonly Bound[]): boolean {
  return (
    view.scope !== DEFAULT_VIEW.scope ||
    view.sector !== DEFAULT_VIEW.sector ||
    hasLimits(bounds, view.bounds)
  )
}

/** What the filters read beside the view: the visitor's own names and the limits the board offers. */
interface FilterContext {
  readonly own: OwnNames
  readonly bounds: readonly Bound[]
}

/** The names that pass every filter, in the order given. */
export function filterCandidates(
  candidates: readonly Candidate[],
  view: BoardView,
  { own, bounds }: FilterContext
): readonly Candidate[] {
  return withinLimits(
    candidates.filter(
      (candidate) =>
        isInScope(candidate, view.scope, own) &&
        (view.sector === NO_SECTOR || candidate.sector === view.sector)
    ),
    bounds,
    view.bounds
  )
}

/** What a board can honour of the visitor's choices. */
interface BoardChoices extends SortChoices {
  readonly sectors: readonly string[]
}

/** The view with each choice this board cannot honour dropped: a sort or a sector it does not
 *  have (the view outlives the data it was made on) reads as the default. */
export function resolveView(view: BoardView, choices: BoardChoices): BoardView {
  const sort = resolveSortKey(view.sort, choices)

  return {
    ...view,
    sort,
    thenSort: resolveThenKey(view.thenSort, sort, choices),
    sector: choices.sectors.includes(view.sector) ? view.sector : NO_SECTOR,
  }
}

/** The sectors the board's names carry, as slugs. */
export function boardSectors(candidates: readonly Candidate[]): readonly string[] {
  return [...new Set(candidates.flatMap(({ sector }) => (sector === undefined ? [] : [sector])))]
}

function isInScope(candidate: Candidate, scope: Scope, own: OwnNames): boolean {
  if (scope === 'all') {
    return true
  }

  return (scope === 'held' ? own.held : own.watched).has(keyOf(candidate.instrument))
}

function readView(market: string): BoardView {
  const stored = readStorage('local', `${STORAGE_PREFIX}${market}`)

  if (stored === undefined) {
    return DEFAULT_VIEW
  }

  try {
    const parsed: unknown = JSON.parse(stored)

    return typeof parsed === 'object' && parsed !== null
      ? toView(Object.fromEntries(Object.entries(parsed)))
      : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

// Each field is read on its own, so a view saved by an older page keeps what still fits.
function toView(stored: Record<string, unknown>): BoardView {
  const text = (key: 'kind' | 'sort' | 'thenSort' | 'sector'): string => {
    const value = stored[key]

    return typeof value === 'string' ? value : DEFAULT_VIEW[key]
  }
  const { scope, direction, thenDirection } = stored

  return {
    kind: text('kind'),
    sort: text('sort'),
    direction: direction === 'desc' ? 'desc' : 'asc',
    thenSort: text('thenSort'),
    thenDirection: thenDirection === 'asc' ? 'asc' : DEFAULT_VIEW.thenDirection,
    scope: scope === 'held' || scope === 'watched' ? scope : 'all',
    sector: text('sector'),
    bounds: toBounds(stored),
  }
}

// A limit typed in the table wins over the same limit a view saved by an older page kept beside it.
function toBounds(stored: Record<string, unknown>): BoardView['bounds'] {
  const { bounds } = stored
  const legacy = Object.entries(LEGACY_LIMITS).map(([field, id]) => [id, stored[field]])
  const current = typeof bounds === 'object' && bounds !== null ? Object.entries(bounds) : []

  return Object.fromEntries(
    [...legacy, ...current].filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}
