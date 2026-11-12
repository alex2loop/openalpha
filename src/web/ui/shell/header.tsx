import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { InstallButton } from '@/web/edition/install-button'
import { ClockControl } from '@/web/scene/overlay/clock-control'
import { ViewSwitch } from '@/web/scene/overlay/view-switch'
import { WeatherChip } from '@/web/scene/overlay/weather-chip'
import { breakpoint } from '@/web/state/breakpoints'
import { cost, isCostCaution } from '@/web/state/cost'
import { isAnalysisOnly } from '@/web/state/edition'
import { isFirstRunOver } from '@/web/state/first-run'
import { runningCount, staleSince, workingTasks } from '@/web/state/live'
import { isInfoOnly } from '@/web/state/pane'
import { setOfficeLayout } from '@/web/state/prefs'
import { brand } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { BellButton } from '@/web/ui/bell/bell-button'
import { BellPopover } from '@/web/ui/bell/bell-popover'
import { COST_POPOVER_ID, CostPopover } from '@/web/ui/cost/cost-popover'
import { formatSpent } from '@/web/ui/cost/spent'
import { JobsPopover } from '@/web/ui/jobs/jobs-popover'
import { LIST_KEY } from '@/web/ui/keys/keys'
import { openKeysDialog } from '@/web/ui/keys/keys-dialog'
import { Chip } from '@/web/ui/kit/chip'
import { CoinIcon, WarningIcon } from '@/web/ui/kit/icons'
import { closePopover, JOBS_POPOVER_ID, openPopoverId, togglePopover } from '@/web/ui/kit/popover'
import { Segmented } from '@/web/ui/kit/segmented'
import { GearButton } from '@/web/ui/settings/gear-button'

import './header.css'

/** The scene's own header controls (the view, the clock, the weather) have nothing to act on in
 *  Focus, where no scene is mounted. */
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
      <div class="header-grow">{isAnalysisOnly.value && <AiNote />}</div>
      {isAnalysisOnly.value && <InstallButton />}
      {isFirstRunOver.value && <CostChip anchor={costAnchor} />}
      {hasScene && <ViewSwitch />}
      <LayoutSwitch />
      {hasScene && (
        <div class="header-clock">
          <ClockControl />
        </div>
      )}
      {hasScene && !isAnalysisOnly.value && <WeatherChip />}
      {!isAnalysisOnly.value && <BellButton anchor={bellAnchor} />}
      <KeysButton />
      <GearButton />
      <JobsPopover anchor={jobsAnchor} />
      <CostPopover anchor={costAnchor} />
      {!isAnalysisOnly.value && <BellPopover anchor={bellAnchor} />}
    </header>
  )
}

interface AnchorProps {
  readonly anchor: RefObject<HTMLButtonElement | null>
}

// Runs and the daemon's own background passes alike: whatever is working now.
function RunningChip({ anchor }: AnchorProps) {
  const count = runningCount.value + workingTasks.value.length
  const isStale = staleSince.value !== undefined

  return (
    <Chip
      title={tr('ui.office.header.runningTip')}
      anchorRef={anchor}
      isExpanded={openPopoverId.value === JOBS_POPOVER_ID}
      onClick={() => togglePopover(JOBS_POPOVER_ID)}
    >
      {count > 0 && !isStale && <span class="spin" aria-hidden="true" />}
      {isStale ? tr('ui.office.stale.unknown') : <RunningText count={count} />}
    </Chip>
  )
}

function RunningText({ count }: { readonly count: number }) {
  if (breakpoint.value !== 'phone') {
    return runningTextOf(count)
  }

  return (
    <>
      <span aria-hidden="true">{count}</span>
      <span class="sr">{runningTextOf(count)}</span>
    </>
  )
}

// A web visitor meets the analysis before any view's own label, so the web header says in red that
// it is AI's and not advice, on one line in the room the controls leave: the short sentence where it
// fits, else the shortest. The full sentence stays in the tip. Every AI-written view carries its own
// label, so the installed version's header says nothing more.
function AiNote() {
  return (
    <p class="header-ai-note" role="note" title={tr('ui.office.scene.aiNote')}>
      <WarningIcon />
      <span class="header-ai-short">{tr('ui.office.scene.aiNoteShort')}</span>
      <span class="header-ai-shortest">{tr('ui.office.scene.aiNoteShortest')}</span>
    </p>
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
// The office scene or Focus, where the information fills the page and the scene is not mounted.
function LayoutSwitch() {
  return (
    <Segmented
      className="layout-toggle"
      label={tr('ui.office.layout.mode')}
      title={tr('ui.office.layout.tip')}
      value={isInfoOnly.value ? 'info' : 'office'}
      options={[
        { value: 'office', label: tr('ui.office.layout.office') },
        { value: 'info', label: tr('ui.office.layout.focus') },
      ]}
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
      onClick={() => openKeysDialog()}
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
      <CostText todayUsd={view?.todayUsd} dailyUsd={view?.caps.dailyUsd} />
    </Chip>
  )
}

interface CostTextProps {
  readonly todayUsd: number | undefined
  readonly dailyUsd: number | undefined
}

// A phone shows today's spend alone, the cap left to the popover, and says both to a screen reader.
function CostText({ todayUsd, dailyUsd }: CostTextProps) {
  const full = formatSpent(todayUsd, dailyUsd)

  if (breakpoint.value !== 'phone') {
    return full
  }

  return (
    <>
      <span class="header-cost-amount" aria-hidden="true">
        {formatSpent(todayUsd, undefined)}
      </span>
      <span class="sr">{full}</span>
    </>
  )
}
