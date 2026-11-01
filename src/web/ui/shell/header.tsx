import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { ClockControl } from '@/web/scene/overlay/clock-control'
import { ViewSwitch } from '@/web/scene/overlay/view-switch'
import { WeatherChip } from '@/web/scene/overlay/weather-chip'
import { breakpoint } from '@/web/state/breakpoints'
import { cost, isCostCaution } from '@/web/state/cost'
import { runningCount, workingTasks } from '@/web/state/live'
import { isInfoOnly, toggleInfoOnly } from '@/web/state/pane'
import { brand, isFirstRun } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { BellButton } from '@/web/ui/bell/bell-button'
import { BellPopover } from '@/web/ui/bell/bell-popover'
import { COST_POPOVER_ID, CostPopover } from '@/web/ui/cost/cost-popover'
import { formatSpent } from '@/web/ui/cost/spent'
import { JobsPopover } from '@/web/ui/jobs/jobs-popover'
import { LIST_KEY } from '@/web/ui/keys/keys'
import { openKeysDialog } from '@/web/ui/keys/keys-dialog'
import { Chip } from '@/web/ui/kit/chip'
import { CoinIcon, InfoOnlyIcon } from '@/web/ui/kit/icons'
import { closePopover, JOBS_POPOVER_ID, openPopoverId, togglePopover } from '@/web/ui/kit/popover'
import { GearButton } from '@/web/ui/settings/gear-button'

import './header.css'

/** The scene's own header controls (the view, the clock, the weather) have nothing to act on in
 *  Info only, where no scene is mounted. */
export function Header() {
  const hasScene = !isInfoOnly.value
  const jobsAnchor = useRef<HTMLButtonElement>(null)
  const costAnchor = useRef<HTMLButtonElement>(null)
  const bellAnchor = useRef<HTMLButtonElement>(null)

  // A popover open when the header leaves (a sign-out) stays closed on the way back.
  useLayoutEffect(() => closePopover, [])

  return (
    <header class="header chrome-glass">
      <div class="header-brand">
        <span class="logo header-logo" aria-hidden="true" />
        {brand.value}
      </div>
      <RunningChip anchor={jobsAnchor} />
      <span class="header-grow" />
      {!isFirstRun.value && <CostChip anchor={costAnchor} />}
      {hasScene && <ViewSwitch />}
      <InfoOnlyToggle />
      {hasScene && <ClockControl />}
      {hasScene && <WeatherChip />}
      <BellButton anchor={bellAnchor} />
      <KeysButton />
      <GearButton />
      <JobsPopover anchor={jobsAnchor} />
      <CostPopover anchor={costAnchor} />
      <BellPopover anchor={bellAnchor} />
    </header>
  )
}

interface AnchorProps {
  readonly anchor: RefObject<HTMLButtonElement | null>
}

// Runs and the daemon's own background passes alike: whatever is working now.
function RunningChip({ anchor }: AnchorProps) {
  const count = runningCount.value + workingTasks.value.length

  return (
    <Chip
      title={tr('ui.office.header.runningTip')}
      anchorRef={anchor}
      isExpanded={openPopoverId.value === JOBS_POPOVER_ID}
      onClick={() => togglePopover(JOBS_POPOVER_ID)}
    >
      {count > 0 && <span class="spin" aria-hidden="true" />}
      {breakpoint.value === 'phone' ? (
        <>
          <span aria-hidden="true">{count}</span>
          <span class="sr">{runningTextOf(count)}</span>
        </>
      ) : (
        runningTextOf(count)
      )}
    </Chip>
  )
}

// A phone shows the bare count and says it in two words to a screen reader, nothing running too.
function runningTextOf(count: number): string {
  if (breakpoint.value === 'phone') {
    const key = pluralKey(
      count,
      'ui.office.header.runningShortOne',
      'ui.office.header.runningShort'
    )

    return tr(key, { count })
  }

  return count === 0
    ? tr('ui.office.header.runningNone')
    : tr(pluralKey(count, 'ui.office.header.runningOne', 'ui.office.header.running'), { count })
}

// Wide screens only: a narrow one picks its pane from the pane bar.
function InfoOnlyToggle() {
  return (
    <button
      type="button"
      class="icon-button layout-toggle"
      title={tr(isInfoOnly.value ? 'ui.office.layout.officeTip' : 'ui.office.layout.infoTip')}
      aria-label={tr('ui.office.layout.info')}
      aria-pressed={isInfoOnly.value}
      onClick={toggleInfoOnly}
    >
      <InfoOnlyIcon />
    </button>
  )
}

function KeysButton() {
  return (
    <button
      type="button"
      class="icon-button header-keys"
      title={tr('ui.office.header.keys')}
      aria-label={tr('ui.office.header.keys')}
      onClick={openKeysDialog}
    >
      {LIST_KEY}
    </button>
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
      <span class="header-cost-label">{tr('ui.office.cost.todayLabel')}</span>
      {formatSpent(view?.todayUsd, view?.caps.dailyUsd)}
    </Chip>
  )
}
