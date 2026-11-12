import type { SuggestionWire, TradingTrackRecordResponse } from '@/app/server/wire/trading'
import { formatDay, pluralKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { locale, state } from '@/web/state/session'
import { AWAITING_WINDOW_CODE, toCaveatText } from '@/web/text/caveat-text'
import { formatSignedPercent, PERCENT, toneOfPercent } from '@/web/text/figures'
import { outcomeNameOf } from '@/web/text/outcome'
import { tr } from '@/web/text/tr'
import { ClockIcon } from '@/web/ui/kit/icons'
import { openWhy } from '@/web/ui/ticker/why-dialog'
import { BlockFrame } from '@/web/ui/today/block-frame'

// Rows read, newest first: more than the card lists.
const PAST_READ = 50
const PAST_SHOWN = 8

type Call = Extract<SuggestionWire, { readonly action: 'buy' | 'reduce' }>

interface PastRead {
  readonly calls: readonly Call[]
  /** The read hit its row limit, so older calls may exist beyond the ones counted. */
  readonly capped: boolean
  /** The name's record as the daemon draws it: repeats folded, matured calls only. */
  readonly summary: TradingTrackRecordResponse['summary']
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
  const capped = reading.data?.capped === true

  return (
    <BlockFrame
      title={tr('ui.office.ticker.pastTitle')}
      colour="gray"
      icon={<ClockIcon />}
      reading={reading}
      action={
        count === undefined || count === 0 ? undefined : <PastCount count={count} capped={capped} />
      }
    >
      {({ calls, summary }) => <PastBody calls={calls} summary={summary} />}
    </BlockFrame>
  )
}

function PastCount({ count, capped }: { readonly count: number; readonly capped: boolean }) {
  const key = pluralKey(count, 'ui.office.ticker.pastCountOne', 'ui.office.ticker.pastCount')

  return <span class="meta">{tr(key, { count: capped ? `${count}+` : count })}</span>
}

function PastBody({ calls, summary }: Pick<PastRead, 'calls' | 'summary'>) {
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
      <PastSummary summary={summary} />
    </>
  )
}

function PastRow({ call }: { readonly call: Call }) {
  const { outcome } = call
  const move = outcome === undefined ? undefined : outcome.returnPct * PERCENT

  return (
    <button
      type="button"
      class="row row-button"
      title={tr('ui.office.ticker.why')}
      onClick={() => openWhy({ kind: 'past', call })}
    >
      <span>
        <b>{tr(`trading.action.${call.action}`)}</b>{' '}
        {outcome === undefined
          ? tr('ui.office.ticker.outcome.open')
          : tr(`trading.outcome.${outcomeNameOf(outcome)}`)}
      </span>
      <span class="meta">{formatDay(locale.value, call.at)}</span>
      {move === undefined ? (
        <span />
      ) : (
        <span class={`pill is-${toneOfPercent(move)}`}>{formatSignedPercent(move)}</span>
      )}
    </button>
  )
}

// The daemon's own minimum says when a rate starts to mean something; the calls still inside
// their window are said once, in the daemon's words.
function PastSummary({ summary }: { readonly summary: PastRead['summary'] }) {
  const scored = summary.resolvedCount
  const hit = summary.focuses.reduce((total, focus) => total + focus.targetCount, 0)
  const minimum = state.value?.trackRecordMinSample
  const awaiting = summary.caveats.find((caveat) => caveat.code === AWAITING_WINDOW_CODE)
  const key =
    minimum !== undefined && scored < minimum
      ? 'ui.office.ticker.pastSummary'
      : 'ui.office.ticker.pastSummaryEnough'

  return (
    <>
      {scored > 0 && <p class="meta">{tr(key, { scored, hit })}</p>}
      {awaiting !== undefined && <p class="meta">{toCaveatText(awaiting)}</p>}
    </>
  )
}

function readPast(ticker: string, market: string): (abort: AbortSignal) => Promise<PastRead> {
  return async (abort) => {
    const [rows, record] = await Promise.all([
      getJson(ROUTES.suggestions, {
        query: { status: 'all', market, ticker, limit: PAST_READ },
        signal: abort,
      }),
      getJson(ROUTES.trackRecord, { query: { market, ticker }, signal: abort }),
    ])

    return {
      calls: rows.suggestions.filter(isCall),
      capped: rows.suggestions.length >= PAST_READ,
      summary: record.summary,
    }
  }
}

function isCall(suggestion: SuggestionWire): suggestion is Call {
  return suggestion.action !== 'hold'
}
