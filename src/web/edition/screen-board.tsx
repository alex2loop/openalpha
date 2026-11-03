import { signal } from '@preact/signals'

import type { ScreenResponse } from '@/app/server/wire/market'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { openTicker } from '@/web/state/known-tickers'
import { printDisplayOf } from '@/web/state/market'
import { formatPrice, formatSignedPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { Segmented } from '@/web/ui/kit/segmented'
import { AnalyzeButton } from '@/web/ui/ticker/analyze-button'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** The most names one read of the board returns (the daemon's own cap). */
const SCREEN_READ_LIMIT = 50

type SortKey = 'ticker' | 'price' | 'change'
type SortDirection = 'asc' | 'desc'
type Candidate = ScreenResponse['candidates'][number]

const SORT_KEYS = Object.freeze(['ticker', 'price', 'change'] as const)
const SORT_LABELS = Object.freeze({
  ticker: 'ui.office.edition.screen.sort.ticker',
  price: 'ui.office.edition.screen.sort.price',
  change: 'ui.office.edition.screen.sort.change',
} as const satisfies Record<SortKey, string>)

// The visitor's choice. It starts on the ticker's own letters: an order that says nothing about
// which name is better, and the one control that is always there to change.
const sortKey = signal<SortKey>('ticker')
const sortDirection = signal<SortDirection>('asc')

/** Màn lọc on the web: the names the market read returned, with their price and move, in the order
 *  the visitor picks. The page ranks nothing and rates nothing: it prints figures and the control
 *  that orders them. */
export function ScreenBoard({ market }: { readonly market: string }) {
  const reading = useBlockRead(
    (abort) =>
      getJson(ROUTES.screen, { query: { market, limit: SCREEN_READ_LIMIT }, signal: abort }),
    { capability: ROUTES.screen.capability }
  )

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

function Names({ board, market }: { readonly board: ScreenResponse; readonly market: string }) {
  if (board.candidates.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  const sorted = sortCandidates(board.candidates, sortKey.value, sortDirection.value)

  return (
    <>
      <p class="meta">{tr('ui.office.edition.screen.note')}</p>
      <SortBar />
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

function SortBar() {
  return (
    <div class="sort-bar">
      <Segmented
        label={tr('ui.office.edition.screen.sortBy')}
        value={sortKey.value}
        options={SORT_KEYS.map((value) => ({ value, label: tr(SORT_LABELS[value]) }))}
        onChange={(value) => {
          sortKey.value = value
        }}
      />
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
      </div>
      <div class="opportunity-ask">
        <AnalyzeButton name={`${market}:${ticker}`} isAnalyzed={false} size="small" />
      </div>
    </div>
  )
}

// A name with no figure for the chosen key goes last in either direction, so a gap is never read as
// the smallest or the largest.
function sortCandidates(
  candidates: readonly Candidate[],
  key: SortKey,
  direction: SortDirection
): readonly Candidate[] {
  const sign = direction === 'asc' ? 1 : -1

  return [...candidates].sort((a, b) =>
    key === 'ticker'
      ? sign * a.instrument.ticker.localeCompare(b.instrument.ticker)
      : compareFigures(figureOf(a, key), figureOf(b, key), sign)
  )
}

function figureOf(candidate: Candidate, key: 'price' | 'change'): number | undefined {
  return key === 'price' ? candidate.price : candidate.changePct
}

function compareFigures(left: number | undefined, right: number | undefined, sign: number): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1
  }

  return right === undefined ? -1 : sign * (left - right)
}
