import type { RefObject } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { ClockControl } from '@/web/scene/overlay/clock-control'
import { cost, isCostCaution } from '@/web/state/cost'
import { runningCount } from '@/web/state/live'
import { brand } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { BellButton } from '@/web/ui/bell/bell-button'
import { BellPopover } from '@/web/ui/bell/bell-popover'
import { COST_POPOVER_ID, CostPopover, formatSpent } from '@/web/ui/cost/cost-popover'
import { JOBS_POPOVER_ID, JobsPopover } from '@/web/ui/jobs/jobs-popover'
import { Chip } from '@/web/ui/kit/chip'
import { CoinIcon } from '@/web/ui/kit/icons'
import { closePopover, openPopoverId, togglePopover } from '@/web/ui/kit/popover'

import './header.css'

export function Header() {
  const jobsAnchor = useRef<HTMLButtonElement>(null)
  const costAnchor = useRef<HTMLButtonElement>(null)
  const bellAnchor = useRef<HTMLButtonElement>(null)

  // A popover open when the header leaves (a sign-out) stays closed on the way back.
  useEffect(() => closePopover, [])

  return (
    <header class="header glass">
      <div class="header-brand">
        <span class="logo header-logo" aria-hidden="true" />
        {brand.value}
      </div>
      <RunningChip anchor={jobsAnchor} />
      <span class="header-grow" />
      <CostChip anchor={costAnchor} />
      <ClockControl />
      <BellButton anchor={bellAnchor} />
      <JobsPopover anchor={jobsAnchor} />
      <CostPopover anchor={costAnchor} />
      <BellPopover anchor={bellAnchor} />
    </header>
  )
}

interface AnchorProps {
  readonly anchor: RefObject<HTMLButtonElement>
}

function RunningChip({ anchor }: AnchorProps) {
  const count = runningCount.value

  return (
    <Chip
      title={tr('ui.office.header.runningTip')}
      anchorRef={anchor}
      isExpanded={openPopoverId.value === JOBS_POPOVER_ID}
      onClick={() => togglePopover(JOBS_POPOVER_ID)}
    >
      {count > 0 && <span class="spin" aria-hidden="true" />}
      {count === 0
        ? tr('ui.office.header.runningNone')
        : tr(pluralKey(count, 'ui.office.header.runningOne', 'ui.office.header.running'), {
            count,
          })}
    </Chip>
  )
}

function CostChip({ anchor }: AnchorProps) {
  const view = cost.value

  return (
    <Chip
      isCaution={isCostCaution.value}
      title={tr('ui.office.header.costTip')}
      anchorRef={anchor}
      isExpanded={openPopoverId.value === COST_POPOVER_ID}
      onClick={() => togglePopover(COST_POPOVER_ID)}
    >
      <CoinIcon />
      {formatSpent(view?.todayUsd, view?.caps.dailyUsd)}
    </Chip>
  )
}
