import type { ComponentChildren } from 'preact'

import type { IndexValuationResponse } from '@/app/server/wire/index-reading'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { formatFixed, formatFixedFraction } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const MULTIPLE_DIGITS = 1
const BOOK_DIGITS = 2
const PERCENT_DIGITS = 1
/** Within this share of its five-year average a multiple reads as in line, not cheap or dear. */
const IN_LINE_FRACTION = 0.03
const PERCENT = 100

type Valuation = NonNullable<IndexValuationResponse['valuation']>

interface IndexValuationProps {
  readonly market: string
  readonly index: { readonly code: string; readonly label: string }
}

/** Định giá: the multiples the daemon stored at its last refresh, set against their own five-year
 *  average. Nothing stored reads as no section; the read never waits on a provider. */
export function IndexValuation({ market, index }: IndexValuationProps) {
  const reading = useBlock(ROUTES.indexValuation, { query: { market, index: index.code } })
  const valuation = reading.data?.valuation

  useRereadAfterRefresh(reading.retry)

  if (reading.state === 'ready' && valuation === undefined) {
    return null
  }

  return (
    <BlockFrame
      title={tr('ui.office.market.valuation.title', { index: index.label })}
      colour="peach"
      icon={<PieIcon />}
      reading={reading}
      dataTo={valuation?.asOf}
    >
      {(data) =>
        data.valuation !== undefined && <Ratios valuation={data.valuation} index={index.label} />
      }
    </BlockFrame>
  )
}

function Ratios({ valuation, index }: { readonly valuation: Valuation; readonly index: string }) {
  const { aboveMa50Pct, aboveMa200Pct, dividendYieldPct } = valuation

  return (
    <>
      <div class="row-list">
        <Ratio
          label={tr('ui.office.market.valuation.pe')}
          value={formatFixed(valuation.pe, MULTIPLE_DIGITS)}
        >
          {standing(valuation.pe, valuation.peAvg5y, MULTIPLE_DIGITS)}
        </Ratio>
        <Ratio
          label={tr('ui.office.market.valuation.pb')}
          value={formatFixed(valuation.pb, BOOK_DIGITS)}
        >
          {standing(valuation.pb, valuation.pbAvg5y, BOOK_DIGITS)}
        </Ratio>
        <Ratio
          label={tr('ui.office.market.valuation.roe')}
          hint={tr('ui.office.market.valuation.roeHint')}
          value={`${formatFixed(valuation.roePct, PERCENT_DIGITS)}%`}
        />
        {dividendYieldPct !== undefined && (
          <Ratio
            label={tr('ui.office.market.valuation.dividendYield')}
            value={`${formatFixed(dividendYieldPct, PERCENT_DIGITS + 1)}%`}
          />
        )}
      </div>
      {aboveMa50Pct !== undefined && aboveMa200Pct !== undefined && (
        <p class="meta">
          {tr('ui.office.market.valuation.aboveMa', {
            index,
            ma50: formatFixedFraction(aboveMa50Pct / PERCENT),
            ma200: formatFixedFraction(aboveMa200Pct / PERCENT),
          })}
        </p>
      )}
    </>
  )
}

interface RatioProps {
  readonly label: string
  readonly value: string
  /** What the label stands for, where it is not what the provider publishes. */
  readonly hint?: string
  readonly children?: ComponentChildren
}

function Ratio({ label, value, hint, children }: RatioProps) {
  return (
    <div class="ratio-row">
      <b class={hint === undefined ? undefined : 'has-hint'} title={hint}>
        {label}
      </b>
      <span class="row-price">{value}</span>
      <span class="row-note">{children}</span>
    </div>
  )
}

/** Where a multiple stands against its five-year average, as a sentence; nothing without the
 *  average. */
function standing(
  current: number,
  average: number | undefined,
  digits: number
): string | undefined {
  if (average === undefined || average <= 0) {
    return undefined
  }

  const gap = (current - average) / average
  const params = {
    average: formatFixed(average, digits),
    pct: formatFixed(Math.abs(gap) * PERCENT, 0),
  }

  if (Math.abs(gap) < IN_LINE_FRACTION) {
    return tr('ui.office.market.valuation.inLine', params)
  }

  return tr(
    gap < 0 ? 'ui.office.market.valuation.cheaper' : 'ui.office.market.valuation.pricier',
    params
  )
}
