import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { SuggestionWire } from '@/app/server/wire/trading'
import type { BlockReading } from '@/web/state/block'
import type { ChartLevel, LevelKey } from '@/web/ui/ticker/chart'
import { formatDay } from '@/i18n'
import { keyOf, stopsBlock } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { ListIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const COPIED_MS = 2_000

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
      <CopyPlan
        text={joinInline([ticker, verdict, ...lines.map((line) => `${line.label} ${line.price}`)])}
      />
    </>
  )
}

// The plan says so for a name not held; a held name's stop row says so too.
function isReviewLevel(plan: SuggestionWire): boolean {
  const key = keyOf(plan.instrument)
  const row = stopsBlock.view.value.data?.stops.find((stop) => keyOf(stop.instrument) === key)

  return plan.reviewOnly === true || row?.review === true
}

// Puts the levels on the clipboard as text and says so for a moment; it places no order.
function CopyPlan({ text }: { readonly text: string }) {
  const isCopied = useSignal(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function copy(): void {
    navigator.clipboard.writeText(text).then(
      () => {
        isCopied.value = true
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          isCopied.value = false
        }, COPIED_MS)
      },
      // A browser that refuses the clipboard leaves the button as it was: nothing was copied.
      () => undefined
    )
  }

  return (
    <Button size="small" onClick={copy}>
      {isCopied.value ? tr('ui.office.ticker.copied') : tr('ui.office.ticker.copyPlan')}
    </Button>
  )
}
