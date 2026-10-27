import type { CostReport } from '@/app/server/wire/system'
import { formatDay } from '@/i18n'
import { locale } from '@/web/state/session'
import { PERCENT } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { openActivityDialog } from '@/web/ui/activity/activity-dialog'
import { formatSpent } from '@/web/ui/cost/spent'

// A day that spent anything stays visible beside the period's highest.
const MIN_BAR_PERCENT = 2

type CostDay = CostReport['days'][number]

/** One bar per day, scaled to the period's highest; a bar opens that day's runs and their calls. */
export function CostChart({ days }: { readonly days: readonly CostDay[] }) {
  const highest = Math.max(...days.map((entry) => entry.costUsd))

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.cost.chart')}</h3>
      <fieldset class="cost-chart">
        <legend class="sr">{tr('ui.office.cost.chart')}</legend>
        {days.map((entry) => (
          <CostBar key={entry.day} entry={entry} highest={highest} />
        ))}
      </fieldset>
      <p class="meta">{tr('ui.office.cost.pickDay')}</p>
    </>
  )
}

function CostBar({ entry, highest }: { readonly entry: CostDay; readonly highest: number }) {
  const label = joinInline([
    formatDay(locale.value, entry.day),
    formatSpent(entry.costUsd, undefined),
  ])
  const height =
    entry.costUsd > 0 && highest > 0
      ? Math.max(MIN_BAR_PERCENT, (entry.costUsd / highest) * PERCENT)
      : 0

  return (
    <button
      type="button"
      class="cost-bar"
      aria-label={label}
      title={label}
      onClick={() => openActivityDialog({ day: entry.day })}
    >
      <svg viewBox={`0 0 1 ${PERCENT}`} preserveAspectRatio="none" aria-hidden="true">
        <rect x={0} y={PERCENT - height} width={1} height={height} />
      </svg>
    </button>
  )
}
