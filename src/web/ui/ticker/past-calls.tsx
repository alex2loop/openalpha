import type { SuggestionWire } from '@/app/server/wire/trading'
import { formatDay, pluralKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { locale, state } from '@/web/state/session'
import { formatSignedPercent, PERCENT, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { ClockIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

// Rows read, newest first: enough to count what was scored, more than the card lists.
const PAST_READ = 50
const PAST_SHOWN = 8

type Call = Extract<SuggestionWire, { readonly action: 'buy' | 'reduce' }>

interface PastRead {
  readonly calls: readonly Call[]
}

interface PastCallsProps {
  readonly ticker: string
  readonly market: string
}

/** "Đề xuất trước đây": the buys and reductions the daemon called on this name and how each ended,
 *  with how many were scored and a warning while that sample is small. */
export function PastCalls({ ticker, market }: PastCallsProps) {
  const reading = useBlockRead(readPast(ticker, market), {
    capability: ROUTES.suggestions.capability,
  })
  const count = reading.data?.calls.length

  return (
    <BlockFrame
      title={tr('ui.office.ticker.pastTitle')}
      colour="gray"
      icon={<ClockIcon />}
      reading={reading}
      action={count === undefined || count === 0 ? undefined : <PastCount count={count} />}
    >
      {({ calls }) => <PastBody calls={calls} />}
    </BlockFrame>
  )
}

function PastCount({ count }: { readonly count: number }) {
  return (
    <span class="meta">
      {tr(pluralKey(count, 'ui.office.ticker.pastCountOne', 'ui.office.ticker.pastCount'), {
        count,
      })}
    </span>
  )
}

function PastBody({ calls }: { readonly calls: readonly Call[] }) {
  if (calls.length === 0) {
    return <p class="meta">{tr('ui.office.ticker.noPlan')}</p>
  }

  return (
    <>
      <div class="row-list">
        {calls.slice(0, PAST_SHOWN).map((call) => (
          <PastRow key={call.id} call={call} />
        ))}
      </div>
      <PastSummary calls={calls} />
    </>
  )
}

function PastRow({ call }: { readonly call: Call }) {
  const { outcome } = call
  const move = outcome === undefined ? undefined : outcome.returnPct * PERCENT

  return (
    <div class="row">
      <span>
        <b>{tr(`trading.action.${call.action}`)}</b>{' '}
        {outcome === undefined
          ? tr('ui.office.ticker.outcome.open')
          : tr(`trading.outcome.${outcome.status}`)}
      </span>
      <span class="meta">{formatDay(locale.value, call.at)}</span>
      {move === undefined ? (
        <span />
      ) : (
        <span class={`pill is-${toneOfPercent(move)}`}>{formatSignedPercent(move)}</span>
      )}
    </div>
  )
}

// The daemon's own minimum says when a rate starts to mean something.
function PastSummary({ calls }: { readonly calls: readonly Call[] }) {
  const scored = calls.filter((call) => call.outcome !== undefined)
  const hit = scored.filter((call) => call.outcome?.status === 'target').length
  const minimum = state.value?.trackRecordMinSample

  if (scored.length === 0) {
    return null
  }

  const key =
    minimum !== undefined && scored.length < minimum
      ? 'ui.office.ticker.pastSummary'
      : 'ui.office.ticker.pastSummaryEnough'

  return <p class="meta">{tr(key, { scored: scored.length, hit })}</p>
}

function readPast(ticker: string, market: string): (abort: AbortSignal) => Promise<PastRead> {
  return async (abort) => {
    const answer = await getJson(ROUTES.suggestions, {
      query: { status: 'all', market, ticker, limit: PAST_READ },
      signal: abort,
    })

    return { calls: answer.suggestions.filter(isCall) }
  }
}

function isCall(suggestion: SuggestionWire): suggestion is Call {
  return suggestion.action !== 'hold'
}
