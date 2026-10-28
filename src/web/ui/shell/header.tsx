import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { ClockControl } from '@/web/scene/overlay/clock-control'
import { ViewSwitch } from '@/web/scene/overlay/view-switch'
import { WeatherChip } from '@/web/scene/overlay/weather-chip'
import { breakpoint } from '@/web/state/breakpoints'
import { cost, isCostCaution } from '@/web/state/cost'
import { runningCount } from '@/web/state/live'
import { isInfoOnly } from '@/web/state/pane'
import { OFFICE_LAYOUTS, type OfficeLayout, officeLayout, setOfficeLayout } from '@/web/state/prefs'
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
import { CoinIcon, DockedIcon, FullOfficeIcon, InfoOnlyIcon } from '@/web/ui/kit/icons'
import { closePopover, JOBS_POPOVER_ID, openPopoverId, togglePopover } from '@/web/ui/kit/popover'
import { Segmented } from '@/web/ui/kit/segmented'
import { GearButton } from '@/web/ui/settings/gear-button'

import './header.css'

const LAYOUTS = Object.freeze({
  docked: {
    icon: <DockedIcon />,
    label: 'ui.office.layout.docked',
    tip: 'ui.office.layout.dockedTip',
  },
  full: {
    icon: <FullOfficeIcon />,
    label: 'ui.office.layout.full',
    tip: 'ui.office.layout.fullTip',
  },
  info: { icon: <InfoOnlyIcon />, label: 'ui.office.layout.info', tip: 'ui.office.layout.infoTip' },
} as const satisfies Record<OfficeLayout, unknown>)

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
      <LayoutSwitch />
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
function LayoutSwitch() {
  return (
    <Segmented
      className="layout-switch"
      label={tr('ui.office.layout.group')}
      value={officeLayout.value}
      options={OFFICE_LAYOUTS.map((value) => ({
        value,
        label: tr(LAYOUTS[value].label),
        icon: LAYOUTS[value].icon,
        title: tr(LAYOUTS[value].tip),
      }))}
      onChange={setOfficeLayout}
    />
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
