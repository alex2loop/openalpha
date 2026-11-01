import { type Signal, useSignal } from '@preact/signals'

import type { CostReport } from '@/app/server/wire/system'
import { formatDay } from '@/i18n'
import { locale } from '@/web/state/session'
import { formatUsd, PERCENT } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { openActivityDialog } from '@/web/ui/activity/activity-dialog'
import { formatSpent } from '@/web/ui/cost/spent'

// A day that spent anything stays visible beside the period's highest.
const MIN_BAR_PERCENT = 2
// Below this many days the first and last date labels would run into each other.
const MIN_DAYS_FOR_TWO_LABELS = 4

type CostDay = CostReport['days'][number]

/** One bar per day, scaled to the period's highest; a bar opens that day's runs and their calls.
 *  The line above names the day under the pointer or focus, the latest day otherwise. */
export function CostChart({ days }: { readonly days: readonly CostDay[] }) {
  const shown = useSignal<string | undefined>(undefined)
  const latest = days[days.length - 1]

  if (latest === undefined) {
    return null
  }

  const highest = Math.max(...days.map((entry) => entry.costUsd))
  const readout = days.find((entry) => entry.day === shown.value) ?? latest

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.cost.chart')}</h3>
      <div class="stack">
        <p class="meta cost-readout">
          <span>{formatDay(locale.value, readout.day)}</span>
          <b class="cost-figure">{formatSpent(readout.costUsd, undefined)}</b>
        </p>
        <CostPlot days={days} highest={highest} latest={latest} shown={shown} />
        <p class="meta">{tr('ui.office.cost.pickDay')}</p>
      </div>
    </>
  )
}

function CostPlot({
  days,
  highest,
  latest,
  shown,
}: {
  readonly days: readonly CostDay[]
  readonly highest: number
  readonly latest: CostDay
  readonly shown: Signal<string | undefined>
}) {
  return (
    <div class="cost-chart">
      <div class="cost-scale" aria-hidden="true">
        <span>{formatUsd(highest)}</span>
        <span>{formatUsd(0)}</span>
      </div>
      <fieldset class="cost-cols cost-plot">
        <legend class="sr">{tr('ui.office.cost.chart')}</legend>
        {days.map((entry) => (
          <CostBar
            key={entry.day}
            entry={entry}
            highest={highest}
            isLatest={entry === latest}
            shown={shown}
          />
        ))}
      </fieldset>
      <div class="cost-cols cost-axis" aria-hidden="true">
        {days.map((entry, index) => (
          <span key={entry.day} class={labelClass(index, days.length)}>
            {isLabelled(index, days.length) && formatDay(locale.value, entry.day)}
          </span>
        ))}
      </div>
    </div>
  )
}

function isLabelled(index: number, count: number): boolean {
  return index === 0 || (index === count - 1 && count >= MIN_DAYS_FOR_TWO_LABELS)
}

function labelClass(index: number, count: number): string {
  return index === count - 1 && index > 0 ? 'cost-day is-last' : 'cost-day'
}

function CostBar({
  entry,
  highest,
  isLatest,
  shown,
}: {
  readonly entry: CostDay
  readonly highest: number
  readonly isLatest: boolean
  readonly shown: Signal<string | undefined>
}) {
  const height =
    entry.costUsd > 0 && highest > 0
      ? Math.max(MIN_BAR_PERCENT, (entry.costUsd / highest) * PERCENT)
      : 0
  const show = () => {
    shown.value = entry.day
  }
  const hide = () => {
    shown.value = undefined
  }

  return (
    <button
      type="button"
      class={isLatest ? 'cost-bar is-latest' : 'cost-bar'}
      aria-label={joinInline([
        formatDay(locale.value, entry.day),
        formatSpent(entry.costUsd, undefined),
      ])}
      onClick={() => openActivityDialog({ day: entry.day })}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <i style={{ height: `${height}%` }} />
    </button>
  )
}
