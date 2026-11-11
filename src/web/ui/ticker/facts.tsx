import type { ScreenResponse } from '@/app/server/wire/market'
import type { Candidate } from '@/web/edition/screen-sort'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { NameNotes } from '@/web/edition/screen-board'
import { useBlockRead } from '@/web/state/block'
import { findMarket } from '@/web/state/market'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { tr } from '@/web/text/tr'
import { FactGrid } from '@/web/ui/kit/fact-grid'
import { TrendIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

interface FactsRead {
  /** Absent when the board left the name out. */
  readonly candidate?: Candidate
  readonly isLoading: boolean
}

interface FactsProps {
  readonly ticker: string
  readonly market: string
}

/** "Chỉ số chính": what the screen read for this name (P/E, liquidity, flows), laid out as the
 *  Screen board lays it; absent for a market with no board. */
export function FactsBlock(props: FactsProps) {
  return findMarket(props.market)?.hasBoard === true ? <Facts {...props} /> : null
}

function Facts({ ticker, market }: FactsProps) {
  const reading = useBlockRead((abort) => readFacts({ ticker, market }, abort), {
    capability: ROUTES.screen.capability,
  })

  useRereadAfterRefresh(reading.retry)

  return (
    <BlockFrame
      title={tr('ui.office.ticker.facts')}
      colour="teal"
      icon={<TrendIcon />}
      reading={reading}
    >
      {({ candidate, isLoading }) =>
        candidate === undefined ? (
          <p class="empty-note">
            {tr(isLoading ? 'ui.office.ticker.factsLoading' : 'ui.office.ticker.factsNone')}
          </p>
        ) : (
          <>
            <FactGrid facts={candidate.facts ?? []} />
            <NameNotes candidate={candidate} />
          </>
        )
      }
    </BlockFrame>
  )
}

// The board is read on the name's own kind, so a fund is found among the funds.
async function readFacts({ ticker, market }: FactsProps, abort: AbortSignal): Promise<FactsRead> {
  const board = await getJson(ROUTES.screen, { query: { market, ticker }, signal: abort })

  return toFactsRead(board, ticker)
}

function toFactsRead(board: ScreenResponse, ticker: string): FactsRead {
  const candidate = board.candidates.find(({ instrument }) => instrument.ticker === ticker)

  return {
    isLoading: board.isLoading === true,
    ...(candidate === undefined ? {} : { candidate }),
  }
}
