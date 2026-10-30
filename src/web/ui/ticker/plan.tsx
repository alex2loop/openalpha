import type { SuggestionWire } from '@/app/server/wire/trading'
import type { BlockReading } from '@/web/state/block'
import type { ChartLevel, LevelKey } from '@/web/ui/ticker/chart'
import { formatDay } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { keyOf, stopsBlock } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { CopyButton } from '@/web/ui/kit/copy-button'
import { ListIcon } from '@/web/ui/kit/icons'
import { useLoad } from '@/web/ui/kit/use-load'
import { PlanReads } from '@/web/ui/ticker/plan-reads'
import { openWhy } from '@/web/ui/ticker/why-dialog'
import { BlockFrame } from '@/web/ui/today/block-frame'

export interface PlanRead {
  readonly plan: SuggestionWire | undefined
}

interface PlanBlockProps {
  readonly reading: BlockReading<PlanRead>
  readonly ticker: string
  readonly market: string
}

/** The levels the plan names, the stop raised where the daily trail lifted it. A buy names the zone
 *  it enters at; a hold or a reduce only the levels it carries. A fund's lower level is a review
 *  and reads as one, held or not. */
export function planLevels(plan: SuggestionWire | undefined): readonly ChartLevel[] {
  if (plan === undefined) {
    return []
  }

  const levels: readonly (readonly [LevelKey, number | undefined])[] = [
    ['buyZone', plan.action === 'buy' ? plan.entry : undefined],
    [isReviewLevel(plan) ? 'review' : 'stop', plan.trailingStop ?? plan.stop],
    ['target', plan.target],
  ]

  return levels.flatMap(([key, value]) => (value === undefined ? [] : [{ key, value }]))
}

/** "Kế hoạch đang mở": the standing call, its levels, and a way to copy them to the exchange. */
export function PlanBlock({ reading, ticker, market }: PlanBlockProps) {
  return (
    <BlockFrame
      title={tr('ui.office.ticker.plan')}
      colour="yellow"
      icon={<ListIcon />}
      reading={reading}
      action={<WhyLink plan={reading.data?.plan} />}
    >
      {({ plan }) =>
        plan === undefined ? (
          <p class="meta">{tr('ui.office.ticker.noPlan')}</p>
        ) : (
          <PlanBody plan={plan} ticker={ticker} market={market} />
        )
      }
    </BlockFrame>
  )
}

function WhyLink({ plan }: { readonly plan: SuggestionWire | undefined }) {
  if (plan === undefined) {
    return null
  }

  return (
    <Button kind="tertiary" size="small" onClick={() => openWhy({ kind: 'plan', call: plan })}>
      {tr('ui.office.ticker.why')}
    </Button>
  )
}

interface PlanBodyProps {
  readonly plan: SuggestionWire
  readonly ticker: string
  readonly market: string
}

function PlanBody({ plan, ticker, market }: PlanBodyProps) {
  const lines = planLevels(plan).map((level) => ({
    label: tr(`ui.office.ticker.${level.key}`),
    price: formatMarketPrice(market, level.value),
  }))
  const verdict = tr(`trading.action.${plan.action}`)

  return (
    <>
      <p>
        <b>{verdict}</b> <span class="meta">{formatDay(locale.value, plan.at)}</span>
      </p>
      <dl class="kv">
        {lines.map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.price}</dd>
          </div>
        ))}
      </dl>
      {/* It places no order: the levels go on the clipboard as text. */}
      <CopyButton
        text={joinInline([ticker, verdict, ...lines.map((line) => `${line.label} ${line.price}`)])}
        label={tr('ui.office.ticker.copyPlan')}
      />
      {/* Keyed so a plan a run replaced reads its own card. */}
      <StandingReads key={plan.id} id={plan.id} />
    </>
  )
}

/** The card's reads for the standing plan. Extra to the levels above, so a failed read says
 *  nothing rather than standing in the plan's way. */
function StandingReads({ id }: { readonly id: string }) {
  const loaded = useLoad((abort) => getJson(ROUTES.suggestionCard(id), { signal: abort }))
  const result = loaded.value

  return result.status === 'ready' && result.value.card !== null ? (
    <PlanReads card={result.value.card} />
  ) : null
}

// The plan says so for a name not held; a held name's stop row says so too.
function isReviewLevel(plan: SuggestionWire): boolean {
  const key = keyOf(plan.instrument)
  const row = stopsBlock.view.value.data?.stops.find((stop) => keyOf(stop.instrument) === key)

  return plan.reviewOnly === true || row?.review === true
}
