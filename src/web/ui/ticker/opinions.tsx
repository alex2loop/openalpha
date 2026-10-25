import type { AgentWire } from '@/app/server/wire/agents'
import type { SuggestionWire } from '@/app/server/wire/trading'
import { formatDay, pluralKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { agents } from '@/web/state/agents'
import { useBlockRead } from '@/web/state/block'
import { locale } from '@/web/state/session'
import { useRetryWhenKnown } from '@/web/state/use-retry-when-known'
import { tr } from '@/web/text/tr'
import { BulbIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The focus that is the operator's own: an agent on it has no call apart from the plan.
const SHARED_FOCUS = 'default'

interface Opinion {
  readonly agent: AgentWire
  readonly call: SuggestionWire
}

interface OpinionsRead {
  readonly opinions: readonly Opinion[]
}

interface OpinionsProps {
  readonly ticker: string
  readonly market: string
  readonly plan: SuggestionWire | undefined
}

/** "Agent của bạn nghĩ gì": each own agent's stored call on this name, as a second opinion that is
 *  scored apart and never changes the plan; absent while none has called. */
export function OpinionsBlock({ ticker, market, plan }: OpinionsProps) {
  const reading = useBlockRead(readOpinions(ticker, market))

  useRetryWhenKnown(agents.value.length > 0, reading.retry)

  const opinions = reading.data?.opinions

  if (opinions?.length === 0) {
    return null
  }

  return (
    <BlockFrame
      title={tr('ui.office.ticker.opinions')}
      colour="peach"
      icon={<BulbIcon />}
      reading={reading}
      action={opinions === undefined ? undefined : <Agreement opinions={opinions} plan={plan} />}
    >
      {(read) => (
        <>
          {read.opinions.map(({ agent, call }) => (
            <div key={agent.id} class="opinion">
              <b>{agent.name}</b>
              <span>
                {tr(`trading.action.${call.action}`)}{' '}
                <span class="meta">{formatDay(locale.value, call.at)}</span>
              </span>
              {call.thesis !== undefined && <span class="meta opinion-note">{call.thesis}</span>}
            </div>
          ))}
          <p class="meta">{tr('ui.office.ticker.opinionNote')}</p>
        </>
      )}
    </BlockFrame>
  )
}

// How many of them go against the plan, or that they stand with it; nothing without a plan.
function Agreement({
  opinions,
  plan,
}: {
  readonly opinions: readonly Opinion[]
  readonly plan: SuggestionWire | undefined
}) {
  if (plan === undefined) {
    return null
  }

  const against = opinions.filter(({ call }) => call.action !== plan.action).length

  return against > 0 ? (
    <span class="is-caution-text">
      {tr(pluralKey(against, 'ui.office.ticker.againstOne', 'ui.office.ticker.against'), {
        count: against,
      })}
    </span>
  ) : (
    <span class="meta">{tr('ui.office.ticker.with')}</span>
  )
}

// One read per focus, not per agent. An agent without a record has no focus a call could sit
// under, and asking for one the daemon does not know is refused.
function readOpinions(
  ticker: string,
  market: string
): (abort: AbortSignal) => Promise<OpinionsRead> {
  return async (abort) => {
    const own = agents.value.filter(
      (agent) => agent.record !== undefined && agent.focusKey !== SHARED_FOCUS
    )
    const focuses = [...new Set(own.map((agent) => agent.focusKey))]
    const settled = await Promise.allSettled(
      focuses.map((focus) =>
        getJson(ROUTES.suggestions, {
          query: { status: 'open', focus, market, ticker },
          signal: abort,
        })
      )
    )
    const rejected = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    )

    // Every read failing is a failure of the block; some failing leaves the opinions that arrived.
    if (focuses.length > 0 && rejected.length === focuses.length) {
      throw rejected[0]
    }

    const calls = new Map(
      focuses.flatMap((focus, index) => {
        const result = settled[index]
        const call = result?.status === 'fulfilled' ? result.value.suggestions[0] : undefined

        return call === undefined ? [] : [[focus, call] as const]
      })
    )

    return {
      opinions: own.flatMap((agent) => {
        const call = calls.get(agent.focusKey)

        return call === undefined ? [] : [{ agent, call }]
      }),
    }
  }
}
