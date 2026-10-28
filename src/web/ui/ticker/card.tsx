import type { SuggestionWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { CardActions } from '@/web/ui/ticker/actions'
import { CardAlerts } from '@/web/ui/ticker/alerts'
import { EventsBlock } from '@/web/ui/ticker/events'
import { HoldingBlock } from '@/web/ui/ticker/holding'
import { OpinionsBlock } from '@/web/ui/ticker/opinions'
import { PastCalls } from '@/web/ui/ticker/past-calls'
import { PlanBlock, type PlanRead, planLevels } from '@/web/ui/ticker/plan'
import { PriceBlock } from '@/web/ui/ticker/price-block'

import './ticker.css'

interface TickerCardProps {
  readonly ticker: string
  readonly market: string
}

/** One name on the info panel. Mounted per name, so its reads end with the card or the name. */
export function TickerCard({ ticker, market }: TickerCardProps) {
  const plan = useBlockRead(readPlan(ticker, market), {
    capability: ROUTES.suggestions.capability,
  })
  const standing: SuggestionWire | undefined = plan.data?.plan

  return (
    <>
      <PriceBlock ticker={ticker} market={market} levels={planLevels(standing)} />
      <PlanBlock reading={plan} ticker={ticker} market={market} />
      <HoldingBlock ticker={ticker} market={market} />
      <OpinionsBlock ticker={ticker} market={market} plan={standing} />
      <PastCalls ticker={ticker} market={market} />
      <CardAlerts ticker={ticker} market={market} />
      <EventsBlock ticker={ticker} market={market} />
      <CardActions ticker={ticker} market={market} />
    </>
  )
}

// The default focus's standing verdict: the call that drives the operator's book.
function readPlan(ticker: string, market: string): (abort: AbortSignal) => Promise<PlanRead> {
  return async (abort) => {
    const answer = await getJson(ROUTES.suggestions, {
      query: { status: 'open', market, ticker },
      signal: abort,
    })

    return { plan: answer.suggestions[0] }
  }
}
