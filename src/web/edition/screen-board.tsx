import { useSignal } from '@preact/signals'

import type { ScreenResponse } from '@/app/server/wire/market'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { DataStatus } from '@/web/edition/data-status'
import { boardBounds } from '@/web/edition/screen-bounds'
import { type Fact, factorFacts, figureFacts, readingFacts } from '@/web/edition/screen-columns'
import { KindSelect, ScreenControls } from '@/web/edition/screen-controls'
import { downloadBoardCsv } from '@/web/edition/screen-csv'
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
  viewOf,
} from '@/web/edition/screen-view'
import { useBlockRead } from '@/web/state/block'
import { openTicker } from '@/web/state/known-tickers'
import { heldPositions, keyOf, printDisplayOf, watchedNames } from '@/web/state/market'
import { formatFixed, formatPrice, formatSignedPercent, PERCENT } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { AnalyzeButton } from '@/web/ui/ticker/analyze-button'
import { WatchButton } from '@/web/ui/ticker/watch-button'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** The names one page of the board holds (the most `/v1/screen` serves at a time). */
const SCREEN_PAGE_LIMIT = 50
/** A board of two thousand names is not a screen; the loop ends there however the answers read. */
const MAX_SCREEN_PAGES = 40
// `2026-11-03`: a day, however the read stamps it.
const DAY_LENGTH = 10
// A coverage reads as a whole percent: `80%` of the factors had data.
const COVERAGE_DIGITS = 0

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
    return <EmptyBoard kinds={board.kinds} market={market} />
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
      <BoardTally board={board} market={market} shown={shown} file={choices} />
      {shown.length === 0 && <p class="empty-note">{tr('ui.office.edition.screen.filter.none')}</p>}
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
  market,
}: {
  readonly kinds: ScreenResponse['kinds']
  readonly market: string
}) {
  return (
    <>
      {kinds !== undefined && (
        <div class="sort-bar">
          <KindSelect market={market} view={viewOf(market).value} kinds={kinds} />
        </div>
      )}
      <p class="empty-note">{tr('ui.office.today.empty')}</p>
    </>
  )
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
    view.sort,
    view.direction
  )

  return { choices, view, shown }
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

interface TallyProps {
  readonly board: ScreenResponse
  readonly market: string
  readonly shown: readonly Candidate[]
  readonly file: Pick<Parameters<typeof downloadBoardCsv>[0], 'baseKeys' | 'metrics' | 'factors'>
}

/** How many names the filters leave, and the way to take them as a file. */
function BoardTally({ board, market, shown, file }: TallyProps) {
  const day = (board.dataThroughDay ?? board.asOf).slice(0, DAY_LENGTH)
  const failure = useSignal<string | undefined>(undefined)

  return (
    <div class="sort-bar">
      <p class="meta">
        {tr('ui.office.edition.screen.filter.count', {
          shown: shown.length,
          total: board.candidates.length,
        })}
      </p>
      <Button
        size="small"
        disabled={shown.length === 0}
        onClick={() => {
          failure.value = undefined
          downloadBoardCsv({ market, day, rows: shown, ...file }).catch(() => {
            failure.value = tr('ui.office.edition.screen.csv.failed')
          })
        }}
      >
        {tr('ui.office.edition.screen.csv.export')}
      </Button>
      {failure.value !== undefined && <p class="meta">{failure.value}</p>}
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
          {ticker}
          {candidate.name === undefined ? '' : ` · ${candidate.name.trim()}`}
        </button>
        <p class="opportunity-evidence">
          {formatPrice(candidate.price, printDisplayOf(market))}
          {candidate.changePct === undefined
            ? ''
            : ` · ${formatSignedPercent(candidate.changePct)}`}
        </p>
        <Facts facts={figureFacts(candidate)} kind="figures" />
        <Facts facts={readingFacts(candidate)} kind="readings" />
        <Facts facts={factorFacts(candidate)} kind="factors" />
        <NameNotes candidate={candidate} />
        {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
      </div>
      <div class="opportunity-ask">
        <AnalyzeButton name={`${market}:${ticker}`} isAnalyzed={false} size="small" />
        <WatchButton ticker={ticker} market={market} failure={failure} size="small" />
      </div>
    </div>
  )
}

// What the page says about the name's place on the board rather than about the name: that the
// operator excluded it, and that some factors had no data to read.
function NameNotes({ candidate }: { readonly candidate: Candidate }) {
  const notes = [
    ...(candidate.excluded === true ? [tr('ui.office.edition.screen.excluded')] : []),
    ...(candidate.coverage === undefined
      ? []
      : [
          tr('ui.office.edition.screen.coverage', {
            pct: formatFixed(candidate.coverage * PERCENT, COVERAGE_DIGITS),
          }),
        ]),
  ]

  return notes.length === 0 ? null : <p class="meta">{joinInline(notes)}</p>
}

// Each kind lays its facts on a grid of its own width, so the rows of a board read alike.
function Facts({ facts, kind }: { readonly facts: readonly Fact[]; readonly kind: string }) {
  if (facts.length === 0) {
    return null
  }

  return (
    <div class={`meta screen-facts is-${kind}`}>
      {facts.map(({ label, value }) => (
        <span key={label ?? value}>
          {label === undefined ? '' : `${label} `}
          <span class="screen-fact-value">{value}</span>
        </span>
      ))}
    </div>
  )
}
