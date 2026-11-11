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

// A market that lists more than one kind serves its first by default, so a fund is looked for on
// the other kinds' boards before the name is called missing.
async function readFacts(name: FactsProps, abort: AbortSignal): Promise<FactsRead> {
  const first = await readBoard(name, undefined, abort)
  let found = toFactsRead(first, name.ticker)

  for (const { kind } of first.kinds?.slice(1) ?? []) {
    if (found.candidate !== undefined) {
      break
    }

    found = toFactsRead(await readBoard(name, kind, abort), name.ticker)
  }

  return found
}

function readBoard(
  { ticker, market }: FactsProps,
  kind: string | undefined,
  abort: AbortSignal
): Promise<ScreenResponse> {
  return getJson(ROUTES.screen, {
    query: { market, ticker, ...(kind === undefined ? {} : { kind }) },
    signal: abort,
  })
}

function toFactsRead(board: ScreenResponse, ticker: string): FactsRead {
  const candidate = board.candidates.find(({ instrument }) => instrument.ticker === ticker)

  return {
    isLoading: board.isLoading === true,
    ...(candidate === undefined ? {} : { candidate }),
  }
}
