import type { PortfolioSharesWire } from '@/app/server/wire/portfolio-shares'
import { formatFixedFraction, PERCENT } from '@/web/text/figures'
import { segmentName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'

import './book.css'

type Segment = PortfolioSharesWire['segments'][number]

/** Each segment's share of the book against its target: the bar is the share, the tick the
 *  target, the gap beside the name. Over target reads in Caution. The daemon rounds the shares
 *  together, so the digits are the chat's. */
export function SegmentBars({ shares }: { readonly shares: PortfolioSharesWire }) {
  return (
    <div class="segment-bars">
      {shares.segments.map((segment) => (
        <SegmentBar key={segment.segment} segment={segment} />
      ))}
    </div>
  )
}

function SegmentBar({ segment }: { readonly segment: Segment }) {
  const classes = segment.gap > 0 ? 'segment-bar is-over' : 'segment-bar'

  return (
    <div class={classes}>
      <div class="segment-bar-head">
        <b>{segmentName(segment.segment)}</b>
        <span class="segment-bar-gap">{formatGap(segment.gap)}</span>
      </div>
      <div class="segment-bar-track">
        <i style={{ width: toWidth(segment.weight) }} />
        <b style={{ left: toWidth(segment.target) }} />
      </div>
      <p class="meta">
        {tr('ui.office.book.segmentShare', {
          weight: formatFixedFraction(segment.weight),
          target: formatFixedFraction(segment.target),
        })}
      </p>
    </div>
  )
}

// Over target reads with a plus, as the percent beside it reads with its own minus.
function formatGap(gap: number): string {
  return gap > 0 ? `+${formatFixedFraction(gap)}` : formatFixedFraction(gap)
}

function toWidth(fraction: number): string {
  return `${Math.min(PERCENT, Math.max(0, fraction * PERCENT))}%`
}
