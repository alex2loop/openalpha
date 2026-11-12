import type { PortfolioSharesWire } from '@/app/server/wire/portfolio-shares'
import { formatFixed, formatFixedFraction, PERCENT } from '@/web/text/figures'
import { segmentName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'

import './book.css'

type Segment = PortfolioSharesWire['segments'][number]

// One hue per segment, from the tile palette; green and red stay for price moves.
const SEGMENT_HUES: Readonly<Record<string, string>> = {
  cash: 'teal',
  crypto: 'violet',
  'equity-vn': 'blue',
  'equity-us': 'pink',
  gold: 'yellow',
  'gold-vn': 'peach',
}
const FALLBACK_HUE = 'gray'
const GAP_DIGITS = 2

/** Each segment's share of the book against the level the user set: the bar is the share in the
 *  segment's hue, the tick their level, the distance from it beside the name in words, largest
 *  first, in one neutral color. The daemon rounds the shares together, so the digits are the
 *  chat's. */
export function SegmentBars({ shares }: { readonly shares: PortfolioSharesWire }) {
  const byGap = [...shares.segments].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))

  return (
    <div class="segment-bars">
      {byGap.map((segment) => (
        <SegmentBar key={segment.segment} segment={segment} />
      ))}
    </div>
  )
}

function SegmentBar({ segment }: { readonly segment: Segment }) {
  return (
    <div class="segment-bar">
      <div class="segment-bar-head">
        <b>{segmentName(segment.segment)}</b>
        <span class="segment-bar-gap">{describeGap(segment.gap)}</span>
      </div>
      <div
        class="segment-bar-track"
        style={`--c: var(--tc-${SEGMENT_HUES[segment.segment] ?? FALLBACK_HUE})`}
      >
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

function describeGap(gap: number): string {
  if (gap === 0) {
    return tr('ui.office.book.gapNone')
  }

  return tr(gap > 0 ? 'ui.office.book.gapAbove' : 'ui.office.book.gapBelow', {
    gap: formatFixed(Math.abs(gap) * PERCENT, GAP_DIGITS),
  })
}

function toWidth(fraction: number): string {
  return `${Math.min(PERCENT, Math.max(0, fraction * PERCENT))}%`
}
