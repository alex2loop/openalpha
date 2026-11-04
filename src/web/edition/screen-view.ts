import { type Signal, signal } from '@preact/signals'

import {
  type BaseSortKey,
  type BoardFactor,
  type Candidate,
  resolveSortKey,
  type SortDirection,
} from '@/web/edition/screen-sort'
import { keyOf } from '@/web/state/market'
import { readStorage, writeStorage } from '@/web/state/storage'
import { toDecimal } from '@/web/text/decimal'

const STORAGE_PREFIX = 'oa.edition.screenView.'
/** The size inputs are typed in billions: a VN market value in whole units runs to fifteen digits. */
const BILLION = 1_000_000_000
const NO_SECTOR = ''

/** Which of the visitor's own names the board shows. */
export type Scope = 'all' | 'held' | 'watched'

/** What the visitor chose for one market's board: its order and its filters. Sizes are kept as
 *  typed, so the field reads back as the visitor wrote it. */
export interface BoardView {
  readonly sort: string
  readonly direction: SortDirection
  readonly scope: Scope
  readonly sector: string
  readonly minTurnover: string
  readonly minMarketCap: string
  readonly maxMarketCap: string
}

/** No filter applied, ordered by the ticker's own letters: an order that says nothing about which
 *  name is better. */
const DEFAULT_VIEW: BoardView = Object.freeze({
  sort: 'ticker' satisfies BaseSortKey,
  direction: 'asc',
  scope: 'all',
  sector: NO_SECTOR,
  minTurnover: '',
  minMarketCap: '',
  maxMarketCap: '',
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

/** Drops every filter and keeps the order. */
export function clearFilters(market: string): void {
  const { sort, direction } = viewOf(market).value

  updateView(market, { ...DEFAULT_VIEW, sort, direction })
}

export function isFiltered(view: BoardView): boolean {
  return (
    view.scope !== DEFAULT_VIEW.scope ||
    view.sector !== DEFAULT_VIEW.sector ||
    [view.minTurnover, view.minMarketCap, view.maxMarketCap].some((size) => size.trim() !== '')
  )
}

/** The names that pass every filter, in the order given. A name with no figure for a size filter
 *  does not pass it: the page cannot say it clears a bar nobody measured. */
export function filterCandidates(
  candidates: readonly Candidate[],
  view: BoardView,
  own: OwnNames
): readonly Candidate[] {
  const minTurnover = sizeOf(view.minTurnover)
  const minMarketCap = sizeOf(view.minMarketCap)
  const maxMarketCap = sizeOf(view.maxMarketCap)

  return candidates.filter((candidate) => {
    const { turnover, marketCap, sector } = candidate

    return (
      isInScope(candidate, view.scope, own) &&
      (view.sector === NO_SECTOR || sector === view.sector) &&
      (minTurnover === undefined || (turnover !== undefined && turnover >= minTurnover)) &&
      (minMarketCap === undefined || (marketCap !== undefined && marketCap >= minMarketCap)) &&
      (maxMarketCap === undefined || (marketCap !== undefined && marketCap <= maxMarketCap))
    )
  })
}

/** What a board can honour of the visitor's choices. */
interface BoardChoices {
  readonly baseKeys: readonly BaseSortKey[]
  readonly factors: readonly BoardFactor[]
  readonly sectors: readonly string[]
}

/** The view with each choice this board cannot honour dropped: a sort or a sector it does not
 *  have (the view outlives the data it was made on) reads as the default. */
export function resolveView(
  view: BoardView,
  { baseKeys, factors, sectors }: BoardChoices
): BoardView {
  return {
    ...view,
    sort: resolveSortKey(view.sort, baseKeys, factors),
    sector: sectors.includes(view.sector) ? view.sector : NO_SECTOR,
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

/** The typed size in whole units; absent for an empty or unreadable field, which filters nothing. */
function sizeOf(text: string): number | undefined {
  const billions = toDecimal(text)

  return billions === undefined ? undefined : billions * BILLION
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

type TextField = 'sort' | 'sector' | 'minTurnover' | 'minMarketCap' | 'maxMarketCap'

// Each field is read on its own, so a view saved by an older page keeps what still fits.
function toView(stored: Record<string, unknown>): BoardView {
  const text = (key: TextField): string => {
    const value = stored[key]

    return typeof value === 'string' ? value : DEFAULT_VIEW[key]
  }
  const { scope, direction } = stored

  return {
    sort: text('sort'),
    direction: direction === 'desc' ? 'desc' : 'asc',
    scope: scope === 'held' || scope === 'watched' ? scope : 'all',
    sector: text('sector'),
    minTurnover: text('minTurnover'),
    minMarketCap: text('minMarketCap'),
    maxMarketCap: text('maxMarketCap'),
  }
}
