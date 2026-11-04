import { useSignal } from '@preact/signals'

import type { ScreenResponse } from '@/app/server/wire/market'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { DataStatus } from '@/web/edition/data-status'
import { figureLine } from '@/web/edition/screen-columns'
import { ScreenControls } from '@/web/edition/screen-controls'
import { downloadBoardCsv } from '@/web/edition/screen-csv'
import {
  boardBaseKeys,
  boardFactors,
  type Candidate,
  sortCandidates,
} from '@/web/edition/screen-sort'
import {
  boardSectors,
  filterCandidates,
  type OwnNames,
  resolveView,
  viewOf,
} from '@/web/edition/screen-view'
import { useBlockRead } from '@/web/state/block'
import { openTicker } from '@/web/state/known-tickers'
import { heldPositions, keyOf, printDisplayOf, watchedNames } from '@/web/state/market'
import { formatFixed, formatPrice, formatSignedPercent } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { AnalyzeButton } from '@/web/ui/ticker/analyze-button'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** The names one page of the board holds (the most `/v1/screen` serves at a time). */
const SCREEN_PAGE_LIMIT = 50
/** A board of two thousand names is not a screen; the loop ends there however the answers read. */
const MAX_SCREEN_PAGES = 40
const FACTOR_VALUE_DIGITS = 2
const PERCENTILE_DIGITS = 0
// `2026-11-03`: a day, however the read stamps it.
const DAY_LENGTH = 10

/** Màn lọc on the web: every priced name the market read returned, with its price and move and what
 *  each factor read for it and where that sits on the board, in the order the visitor picks. The
 *  page ranks nothing and rates nothing: it prints figures and the control that orders them. */
export function ScreenBoard({ market }: { readonly market: string }) {
  const reading = useBlockRead((abort) => readBoard(market, abort), {
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

// The board is read whole, a page at a time, so the visitor sorts every name and not a page of them.
async function readBoard(market: string, abort: AbortSignal): Promise<ScreenResponse> {
  const first = await readPage({ market, abort })
  const names = [...first.candidates]
  let cursor = first.next

  for (let page = 1; cursor !== undefined && page < MAX_SCREEN_PAGES; page++) {
    const answer = await readPage({ market, cursor, abort })

    names.push(...answer.candidates)
    cursor = answer.next
  }

  const { next: _firstCursor, ...board } = first

  return { ...board, candidates: names }
}

interface PageRead {
  readonly market: string
  readonly cursor?: string
  readonly abort: AbortSignal
}

function readPage({ market, cursor, abort }: PageRead): Promise<ScreenResponse> {
  return getJson(ROUTES.screen, {
    query: { market, limit: SCREEN_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
    signal: abort,
  })
}

function Names({ board, market }: { readonly board: ScreenResponse; readonly market: string }) {
  if (board.candidates.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  const baseKeys = boardBaseKeys(board.candidates)
  const factors = boardFactors(board.candidates)
  const sectors = boardSectors(board.candidates)
  const view = resolveView(viewOf(market).value, { baseKeys, factors, sectors })
  const shown = sortCandidates(
    filterCandidates(board.candidates, view, ownNames()),
    view.sort,
    view.direction
  )

  return (
    <>
      <DataStatus />
      {board.card.notes.map((line) => (
        <p key={line} class="meta">
          {line}
        </p>
      ))}
      <ScreenControls
        market={market}
        view={view}
        baseKeys={baseKeys}
        factors={factors}
        sectors={sectors}
      />
      <BoardTally board={board} market={market} shown={shown} file={{ baseKeys, factors }} />
      {shown.length === 0 && <p class="empty-note">{tr('ui.office.edition.screen.filter.none')}</p>}
      {shown.map((candidate) => (
        <NameRow key={candidate.instrument.ticker} candidate={candidate} market={market} />
      ))}
      {[...board.card.caveats, ...board.card.provenance].map((line) => (
        <p key={line} class="meta">
          {line}
        </p>
      ))}
    </>
  )
}

interface TallyProps {
  readonly board: ScreenResponse
  readonly market: string
  readonly shown: readonly Candidate[]
  readonly file: Pick<Parameters<typeof downloadBoardCsv>[0], 'baseKeys' | 'factors'>
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
        <FigureLine candidate={candidate} />
        {(candidate.factors ?? []).map((factor) => (
          <p key={factor.id} class="meta">
            {toFactorLine(factor)}
          </p>
        ))}
      </div>
      <div class="opportunity-ask">
        <AnalyzeButton name={`${market}:${ticker}`} isAnalyzed={false} size="small" />
      </div>
    </div>
  )
}

function toFactorLine(factor: NonNullable<Candidate['factors']>[number]): string {
  const value = `${factor.value > 0 ? '+' : ''}${formatFixed(factor.value, FACTOR_VALUE_DIGITS)}`

  return factor.percentile === undefined
    ? joinInline([factor.label, value])
    : tr('ui.office.edition.screen.factorLine', {
        label: factor.label,
        value,
        pct: formatFixed(factor.percentile, PERCENTILE_DIGITS),
      })
}

function FigureLine({ candidate }: { readonly candidate: Candidate }) {
  const line = figureLine(candidate)

  return line === '' ? null : <p class="meta">{line}</p>
}
