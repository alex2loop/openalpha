import { useEffect, useRef } from 'preact/hooks'

import {
  CLOCK_PRESET_HOURS,
  CLOCK_SPEEDS,
  type ClockMode,
  type ClockSpeed,
  clockMode,
  pageHour,
  pageMinute,
  pageNow,
  setClock,
} from '@/web/scene/clock/clock'
import { reducedMotion } from '@/web/state/prefs'
import { state } from '@/web/state/session'
import { formatClock, formatHourOfDay } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Chip } from '@/web/ui/kit/chip'
import { openPopoverId, Popover, togglePopover } from '@/web/ui/kit/popover'

import './clock-control.css'

const CLOCK_POPOVER_ID = 'clock'
const REAL_SPEED: ClockSpeed = 1
// Float tolerance for a preview still standing on the preset it started from.
const PRESET_MATCH_HOURS = 1 / 3600
const PRESETS = Object.freeze([
  { hour: CLOCK_PRESET_HOURS[0], key: 'ui.office.clock.preset.dawn' },
  { hour: CLOCK_PRESET_HOURS[1], key: 'ui.office.clock.preset.morning' },
  { hour: CLOCK_PRESET_HOURS[2], key: 'ui.office.clock.preset.noon' },
  { hour: CLOCK_PRESET_HOURS[3], key: 'ui.office.clock.preset.afternoon' },
  { hour: CLOCK_PRESET_HOURS[4], key: 'ui.office.clock.preset.evening' },
  { hour: CLOCK_PRESET_HOURS[5], key: 'ui.office.clock.preset.night' },
] as const)
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowUp'])
const NEXT_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown'])

/** The header clock: the page clock in the operator's `[locale] timezone`, and the hour picker. */
export function ClockControl() {
  const anchor = useRef<HTMLButtonElement>(null)
  const timeZone = state.value?.timeZone

  // Read so the chip re-renders at each page minute.
  pageMinute.value

  if (timeZone === undefined) {
    return null
  }

  return (
    <>
      <Chip
        title={tr('ui.office.clock.tip')}
        anchorRef={anchor}
        isExpanded={openPopoverId.value === CLOCK_POPOVER_ID}
        onClick={() => togglePopover(CLOCK_POPOVER_ID)}
      >
        {formatClock(pageNow(), timeZone)}
        <ClockBadge mode={clockMode.value} />
      </Chip>
      <Popover
        id={CLOCK_POPOVER_ID}
        anchor={anchor}
        label={tr('ui.office.clock.tip')}
        class="clock-popover"
      >
        <ClockBody />
      </Popover>
    </>
  )
}

function ClockBadge({ mode }: { readonly mode: ClockMode }) {
  if (mode.kind === 'real') {
    return null
  }

  return (
    <span class="clock-badge">
      {mode.speed === REAL_SPEED
        ? tr('ui.office.clock.badgePreview')
        : tr('ui.office.clock.speedValue', { speed: mode.speed })}
    </span>
  )
}

function ClockBody() {
  const body = useRef<HTMLDivElement>(null)
  const mode = clockMode.value

  useEffect(() => (body.current === null ? undefined : armArrows(body.current)), [])

  return (
    <div ref={body} class="clock-body">
      <button
        type="button"
        class="clock-choice"
        aria-pressed={mode.kind === 'real'}
        onClick={() => setClock({ kind: 'real' })}
      >
        {tr('ui.office.clock.real')}
      </button>
      <PresetGrid mode={mode} />
      <SpeedRow mode={mode} />
      {reducedMotion.value && <p class="meta">{tr('ui.office.clock.reducedNote')}</p>}
      <p class="meta">{tr('ui.office.clock.note')}</p>
    </div>
  )
}

function PresetGrid({ mode }: { readonly mode: ClockMode }) {
  const speed = mode.kind === 'preview' ? mode.speed : REAL_SPEED

  return (
    <div class="clock-presets">
      {PRESETS.map(({ hour, key }) => (
        <button
          key={key}
          type="button"
          class="clock-choice"
          aria-pressed={mode.kind === 'preview' && Math.abs(mode.hour - hour) < PRESET_MATCH_HOURS}
          onClick={() => setClock({ kind: 'preview', hour, speed })}
        >
          {tr(key)}
          <span class="clock-preset-time">{formatHourOfDay(hour)}</span>
        </button>
      ))}
    </div>
  )
}

function SpeedRow({ mode }: { readonly mode: ClockMode }) {
  const current = mode.kind === 'preview' ? mode.speed : REAL_SPEED

  return (
    <div class="clock-speed">
      <span class="meta">{tr('ui.office.clock.speed')}</span>
      {CLOCK_SPEEDS.map((speed) => (
        <button
          key={speed}
          type="button"
          class="clock-choice"
          aria-pressed={current === speed}
          disabled={reducedMotion.value && speed !== REAL_SPEED}
          onClick={() => pickSpeed(mode, speed)}
        >
          {tr('ui.office.clock.speedValue', { speed })}
        </button>
      ))}
    </div>
  )
}

// Real time at normal speed stays real; any other speed runs a preview on from the hour now shown.
function pickSpeed(mode: ClockMode, speed: ClockSpeed): void {
  if (mode.kind === 'real' && speed === REAL_SPEED) {
    return
  }

  setClock({ kind: 'preview', hour: pageHour(), speed })
}

// Focus lands on the choice in force; arrows then walk the enabled buttons, wrapping round.
function armArrows(body: HTMLElement): () => void {
  const listeners = new AbortController()

  body.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
  body.addEventListener('keydown', (event) => moveFocus(body, event), {
    signal: listeners.signal,
  })

  return () => listeners.abort()
}

function moveFocus(body: HTMLElement, event: KeyboardEvent): void {
  const step = stepOf(event.key)

  if (step === 0) {
    return
  }

  const buttons = [...body.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
  const active = document.activeElement
  const at = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1

  if (at === -1) {
    return
  }

  event.preventDefault()
  buttons[(at + step + buttons.length) % buttons.length]?.focus()
}

function stepOf(key: string): number {
  if (PREVIOUS_KEYS.has(key)) {
    return -1
  }

  return NEXT_KEYS.has(key) ? 1 : 0
}
