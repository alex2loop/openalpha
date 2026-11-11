import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { ScreenResponse } from '@/app/server/wire/market'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { DataStatus } from '@/web/edition/data-status'
import { boardBounds } from '@/web/edition/screen-bounds'
import { KindSelect, ScreenControls } from '@/web/edition/screen-controls'
import {
  boardBaseKeys,
  boardFactors,
  boardMetrics,
  type Candidate,
  sortCandidates,
} from '@/web/edition/screen-sort'
import {
  boardSectors,
  clearKind,
  DEFAULT_KIND,
  filterCandidates,
  type OwnNames,
  resolveView,
  sortOrdersOf,
  viewOf,
} from '@/web/edition/screen-view'
import { useBlockRead } from '@/web/state/block'
import { openTicker } from '@/web/state/known-tickers'
import { heldPositions, keyOf, printDisplayOf, watchedNames } from '@/web/state/market'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { formatPrice, formatSignedPercent } from '@/web/text/figures'
import { joinInline, joinList } from '@/web/text/glyphs'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { FactGrid } from '@/web/ui/kit/fact-grid'
import { TrendIcon } from '@/web/ui/kit/icons'
import { AnalyzeButton } from '@/web/ui/ticker/analyze-button'
import { WatchButton } from '@/web/ui/ticker/watch-button'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** The names one page of the board holds (the most `/v1/screen` serves at a time). */
const SCREEN_PAGE_LIMIT = 50
/** A board of two thousand names is not a screen; the loop ends there however the answers read. */
const MAX_SCREEN_PAGES = 40
/** How long a board read during the market's first load waits before it asks again. */
const FIRST_LOAD_RECHECK_MS = 15_000

/** Màn lọc on the web: every priced name the market read returned, with its price and move, the
 *  plain values its market states and what each factor read for it and where that sits on the board,
 *  in the order the visitor picks. The page ranks nothing and rates nothing: it prints figures and
 *  the control that orders them. */
export function ScreenBoard({ market }: { readonly market: string }) {
  // The kind is part of the read, so choosing another mounts the board afresh.
  const { kind } = viewOf(market).value

  return <KindBoard key={kind} market={market} kind={kind} />
}

function KindBoard({ market, kind }: { readonly market: string; readonly kind: string }) {
  const reading = useBlockRead((abort) => readBoard({ market, kind, abort }), {
    capability: ROUTES.screen.capability,
  })
  const isLoading = reading.data?.isLoading === true

  // Reads again when a `/refresh` ends, and every few seconds while the first load runs: that load
  // belongs to the page's own worker, which says nothing when it ends.
  useRereadAfterRefresh(reading.retry)
  useEffect(() => {
    if (!isLoading) {
      return undefined
    }

    const timer = setTimeout(reading.retry, FIRST_LOAD_RECHECK_MS)

    return () => clearTimeout(timer)
  }, [isLoading, reading.readAt])

  return (
    <BlockFrame
      title={tr('ui.office.edition.screen.title')}
      colour="teal"
      icon={<TrendIcon />}
      reading={reading}
      dataTo={reading.data?.dataThroughDay ?? reading.data?.asOf}
    >
      {(board) => <Names board={board} market={market} />}
    </BlockFrame>
  )
}

interface BoardRead {
  readonly market: string
  /** Empty asks for the market's own first kind. */
  readonly kind: string
  readonly abort: AbortSignal
}

// A kind the market does not serve (the choice outlives the market's lists) puts the visitor back
// on the first kind, whether the read is refused or answers with a list that lacks it.
async function readBoard(read: BoardRead): Promise<ScreenResponse> {
  const { market, kind } = read

  try {
    const board = await readWholeBoard(read)

    if (kind !== DEFAULT_KIND && board.kinds?.some((listed) => listed.kind === kind) !== true) {
      clearKind(market)
    }

    return board
  } catch (error) {
    if (kind !== DEFAULT_KIND && error instanceof ApiFailure) {
      clearKind(market)
    }

    throw error
  }
}

// The board is read whole, a page at a time, so the visitor sorts every name and not a page of them.
async function readWholeBoard({ market, kind, abort }: BoardRead): Promise<ScreenResponse> {
  const first = await readPage({ market, kind, abort })
  const names = [...first.candidates]
  let cursor = first.next

  for (let page = 1; cursor !== undefined && page < MAX_SCREEN_PAGES; page++) {
    const answer = await readPage({ market, kind, cursor, abort })

    names.push(...answer.candidates)
    cursor = answer.next
  }

  const { next: _firstCursor, ...board } = first

  return { ...board, candidates: names }
}

interface PageRead extends BoardRead {
  readonly cursor?: string
}

function readPage({ market, kind, cursor, abort }: PageRead): Promise<ScreenResponse> {
  return getJson(ROUTES.screen, {
    query: {
      market,
      limit: SCREEN_PAGE_LIMIT,
      ...(kind === DEFAULT_KIND ? {} : { kind }),
      ...(cursor === undefined ? {} : { cursor }),
    },
    signal: abort,
  })
}

function Names({ board, market }: { readonly board: ScreenResponse; readonly market: string }) {
  if (board.candidates.length === 0) {
    return <EmptyBoard kinds={board.kinds} caveats={board.card.caveats} market={market} />
  }

  const { choices, view, shown } = arrange(board, market)

  return (
    <>
      <DataStatus />
      {board.card.notes.map((line) => (
        <p key={line} class="meta">
          {line}
        </p>
      ))}
      <ScreenControls market={market} view={view} {...choices} kinds={board.kinds} />
      <BoardTally shown={shown.length} total={board.candidates.length} />
      {shown.length === 0 && (
        <NoMatch query={view.query} hasRejections={board.card.rejections.length > 0} />
      )}
      {shown.map((candidate) => (
        <NameRow key={candidate.instrument.ticker} candidate={candidate} market={market} />
      ))}
      <Rejections lines={board.card.rejections} />
      {[...board.card.caveats, ...board.card.provenance].map((line) => (
        <p key={line} class="meta">
          {line}
        </p>
      ))}
    </>
  )
}

// A kind with no names still offers the others, so the visitor is never left on it.
function EmptyBoard({
  kinds,
  caveats,
  market,
}: {
  readonly kinds: ScreenResponse['kinds']
  readonly caveats: readonly string[]
  readonly market: string
}) {
  return (
    <>
      {kinds !== undefined && (
        <div class="sort-bar">
          <KindSelect market={market} view={viewOf(market).value} kinds={kinds} />
        </div>
      )}
      <EmptyNote lines={caveats} />
    </>
  )
}

// The board's own caveats say why it is empty (the first load still running, or stopped partway);
// without them the market simply has no name to list.
function EmptyNote({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  return lines.map((line) => (
    <p key={line} class="meta">
      {line}
    </p>
  ))
}

/** What the board offers to order and filter by, the visitor's view with each choice it cannot
 *  honour dropped, and the names that pass, in the visitor's order. */
function arrange(board: ScreenResponse, market: string) {
  const baseKeys = boardBaseKeys(board.candidates)
  const metrics = boardMetrics(board.candidates)
  const choices = {
    baseKeys,
    metrics,
    factors: boardFactors(board.candidates),
    sectors: boardSectors(board.candidates),
    bounds: boardBounds(baseKeys, metrics),
  }
  const view = resolveView(viewOf(market).value, choices)
  const shown = sortCandidates(
    filterCandidates(board.candidates, view, { own: ownNames(), bounds: choices.bounds }),
    sortOrdersOf(view)
  )

  return { choices, view, shown }
}

// A search that finds nothing may be a name the gates left out, which only the list below can say.
function NoMatch({
  query,
  hasRejections,
}: {
  readonly query: string
  readonly hasRejections: boolean
}) {
  const typed = query.trim()
  const lines =
    typed === ''
      ? [tr('ui.office.edition.screen.filter.none')]
      : [
          tr('ui.office.edition.screen.filter.searchNone', { query: typed }),
          ...(hasRejections ? [tr('ui.office.edition.screen.filter.searchRejected')] : []),
        ]

  return <p class="empty-note">{lines.join(' ')}</p>
}

// What the gates left out, and why, as the CLI words it: a board of the names that cleared them
// would otherwise say nothing about the rest.
function Rejections({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) {
    return null
  }

  return (
    <details class="meta">
      <summary>{tr('ui.office.edition.screen.rejections')}</summary>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </details>
  )
}

/** How many names the filters leave. */
function BoardTally({ shown, total }: { readonly shown: number; readonly total: number }) {
  return (
    <div class="sort-bar">
      <p class="meta">{tr('ui.office.edition.screen.filter.count', { shown, total })}</p>
    </div>
  )
}

/** The visitor's own names on this board; reading the signals makes the board follow them. */
function ownNames(): OwnNames {
  return {
    held: new Set(heldPositions.value.map(({ instrument }) => keyOf(instrument))),
    watched: new Set(watchedNames.value.map(keyOf)),
  }
}

function NameRow({
  candidate,
  market,
}: {
  readonly candidate: Candidate
  readonly market: string
}) {
  const { ticker } = candidate.instrument
  const failure = useSignal<string | undefined>(undefined)

  return (
    <div class="opportunity">
      <div class="opportunity-main">
        <button type="button" class="opportunity-line" onClick={() => openTicker(ticker, market)}>
          {joinInline(nameHead(candidate))}
        </button>
        <p class="opportunity-evidence">
          {formatPrice(candidate.price, printDisplayOf(market))}
          {candidate.changePct === undefined
            ? ''
            : ` · ${formatSignedPercent(candidate.changePct)}`}
        </p>
      </div>
      <div class="opportunity-ask">
        <AnalyzeButton name={`${market}:${ticker}`} isAnalyzed={false} size="small" />
        <WatchButton ticker={ticker} market={market} failure={failure} size="small" />
      </div>
      <div class="opportunity-body">
        <FactGrid facts={candidate.facts ?? []} />
        <NameNotes candidate={candidate} />
        {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
      </div>
    </div>
  )
}

// The ticker, the sector its market files it under and its company name, each where known.
function nameHead({ instrument, sector, name }: Candidate): readonly string[] {
  return [
    instrument.ticker,
    ...(sector === undefined ? [] : [sectorName(sector)]),
    ...(name === undefined ? [] : [name.trim()]),
  ]
}

// What the page says about the name's place on the board rather than about the name: that the
// operator excluded it, and which factors had no data to read.
export function NameNotes({ candidate }: { readonly candidate: Candidate }) {
  const notes = [
    ...(candidate.excluded === true ? [tr('ui.office.edition.screen.excluded')] : []),
    ...(candidate.missing === undefined
      ? []
      : [tr('trading.render.screen.missing', { factors: joinList(candidate.missing) })]),
  ]

  return notes.length === 0 ? null : <p class="meta">{joinInline(notes)}</p>
}
