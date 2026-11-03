import { signal } from '@preact/signals'

import type { ScreenResponse } from '@/app/server/wire/market'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { DataStatus } from '@/web/edition/data-status'
import {
  type BoardFactor,
  boardFactors,
  type Candidate,
  FACTOR_SORT_PREFIX,
  SORT_BASE_KEYS,
  type SortDirection,
  sortCandidates,
} from '@/web/edition/screen-sort'
import { useBlockRead } from '@/web/state/block'
import { openTicker } from '@/web/state/known-tickers'
import { printDisplayOf } from '@/web/state/market'
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

const SORT_LABELS = Object.freeze({
  ticker: 'ui.office.edition.screen.sort.ticker',
  price: 'ui.office.edition.screen.sort.price',
  change: 'ui.office.edition.screen.sort.change',
} as const)

// The visitor's choice. It starts on the ticker's own letters: an order that says nothing about
// which name is better, and the one control that is always there to change.
const sortKey = signal<string>('ticker')
const sortDirection = signal<SortDirection>('asc')

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

  return { ...first, candidates: names }
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

  const factors = boardFactors(board.candidates)
  const sorted = sortCandidates(board.candidates, sortKey.value, sortDirection.value)

  return (
    <>
      <DataStatus />
      {board.card.notes.map((line) => (
        <p key={line} class="meta">
          {line}
        </p>
      ))}
      <SortBar factors={factors} />
      {sorted.map((candidate) => (
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

function SortBar({ factors }: { readonly factors: readonly BoardFactor[] }) {
  const label = tr('ui.office.edition.screen.sortBy')

  return (
    <div class="sort-bar">
      <select
        aria-label={label}
        value={sortKey.value}
        onChange={(event) => {
          sortKey.value = event.currentTarget.value
        }}
      >
        {SORT_BASE_KEYS.map((key) => (
          <option key={key} value={key}>
            {tr(SORT_LABELS[key])}
          </option>
        ))}
        {factors.map(({ id, label: name }) => (
          <option key={id} value={`${FACTOR_SORT_PREFIX}${id}`}>
            {name}
          </option>
        ))}
      </select>
      <Button
        size="small"
        onClick={() => {
          sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
        }}
      >
        {tr(
          sortDirection.value === 'asc'
            ? 'ui.office.edition.screen.ascending'
            : 'ui.office.edition.screen.descending'
        )}
      </Button>
    </div>
  )
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
        {(candidate.factors ?? []).map((factor) => (
          <p key={factor.id} class="meta">
            {factorLine(factor)}
          </p>
        ))}
      </div>
      <div class="opportunity-ask">
        <AnalyzeButton name={`${market}:${ticker}`} isAnalyzed={false} size="small" />
      </div>
    </div>
  )
}

function factorLine(factor: NonNullable<Candidate['factors']>[number]): string {
  const value = `${factor.value > 0 ? '+' : ''}${formatFixed(factor.value, FACTOR_VALUE_DIGITS)}`

  return factor.percentile === undefined
    ? joinInline([factor.label, value])
    : tr('ui.office.edition.screen.factorLine', {
        label: factor.label,
        value,
        pct: formatFixed(factor.percentile, 0),
      })
}
