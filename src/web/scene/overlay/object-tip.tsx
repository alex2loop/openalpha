import { signal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'

import type { RoomId, ScreenPoint } from '@/web/scene/types'
import type { TipSource } from '@/web/scene/world/props'
import type { Run } from '@/web/state/live'
import { pluralKey } from '@/i18n'
import { agenda, alertsTask } from '@/web/scene/data/agenda'
import {
  alertCounts,
  debateLine,
  isPrintingRun,
  roomStatus,
  toParamText,
} from '@/web/scene/data/room-status'
import { focusRun } from '@/web/state/focus'
import { unseenCalls } from '@/web/state/ideas'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock } from '@/web/text/time'
import { MS_PER_SECOND } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { BELL_POPOVER_ID, openPopover } from '@/web/ui/kit/popover'

import './object-tip.css'

// Long enough for the pointer to cross from the object to its tip.
const TIP_HIDE_MS = 300
// The tip sits this far below the pointer, so it never covers what it describes.
const TIP_OFFSET_PX = 14

/** Where a click on the object goes, named on the tip's last line. */
interface TipGo {
  readonly label: string
  readonly run: () => void
}

interface TipContent {
  readonly title: string
  readonly lines: readonly string[]
  readonly go?: TipGo
}

interface Shown {
  readonly source: TipSource
  readonly at: ScreenPoint
}

type TipReader = () => TipContent | undefined

const shown = signal<Shown | undefined>(undefined)
let hideTimer: ReturnType<typeof setTimeout> | undefined

const TIP_READERS: Readonly<Record<TipSource, TipReader>> = Object.freeze({
  shelf: () => undefined,
  printer: printerTip,
  store: storeTip,
  meet: meetTip,
  results: resultsTip,
  clock: clockTip,
  alerts: alertsTip,
  agenda: agendaTip,
  cat: () => ({
    title: tr('ui.office.pet.cat'),
    lines: [tr('ui.office.pet.catTip')],
    go: { label: tr('ui.office.pet.catGo'), run: () => openPopover(BELL_POPOVER_ID) },
  }),
  corgi: () => ({ title: tr('ui.office.pet.corgi'), lines: [tr('ui.office.pet.corgiTip')] }),
  fish: () => ({ title: tr('ui.office.pet.fish'), lines: [] }),
} satisfies Record<TipSource, TipReader>)

/** The pointer is over something with a tip (or over nothing) at `at`: a live figure shows its
 *  tip; nothing to say, or nothing there, hides it after a beat. */
export function hoverObject(source: TipSource | undefined, at: ScreenPoint): void {
  if (source === undefined || TIP_READERS[source]() === undefined) {
    scheduleHide()
    return
  }

  cancelHide()
  shown.value = { source, at }
}

/** Where a click on what the tip is about goes, when its tip names a place. */
export function tipActionOf(source: TipSource | undefined): (() => void) | undefined {
  return source === undefined ? undefined : TIP_READERS[source]()?.go?.run
}

/** The one object tip; its hide timer belongs to it and ends with it. */
export function ObjectTip() {
  const held = shown.value
  const tip = held === undefined ? undefined : TIP_READERS[held.source]()

  useLayoutEffect(() => clearTip, [])

  if (held === undefined || tip === undefined) {
    return null
  }

  return (
    <div
      class="object-tip glass"
      role="tooltip"
      style={{ left: `${held.at.x}px`, top: `${held.at.y + TIP_OFFSET_PX}px` }}
      onPointerEnter={cancelHide}
      onPointerLeave={scheduleHide}
    >
      <b>{tip.title}</b>
      {tip.lines.map((line) => (
        <p key={line} class="meta">
          {line}
        </p>
      ))}
      {tip.go !== undefined && (
        <button type="button" class="object-tip-go" onClick={tip.go.run}>
          {tip.go.label}
        </button>
      )}
    </div>
  )
}

function scheduleHide(): void {
  cancelHide()
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    shown.value = undefined
  }, TIP_HIDE_MS)
}

function clearTip(): void {
  cancelHide()
  shown.value = undefined
}

function cancelHide(): void {
  clearTimeout(hideTimer)
  hideTimer = undefined
}

function focusRunOf(room: RoomId): Run | undefined {
  return roomStatus.value.get(room)?.runs[0]
}

function jumpTo(run: Run, label: string): TipGo {
  return { label, run: () => focusRun(run.runId) }
}

function printerTip(): TipContent | undefined {
  const run = focusRunOf('lib')
  const topic = roomStatus.value.get('lib')?.subject

  if (run === undefined || !isPrintingRun(run) || topic === undefined) {
    return undefined
  }

  return {
    title: tr('ui.office.tip.printer'),
    lines: [tr('ui.office.tip.printerLine', { topic })],
    go: jumpTo(run, tr('ui.office.common.view')),
  }
}

function storeTip(): TipContent | undefined {
  const run = focusRunOf('store')
  const params = run?.progress?.params
  const done = toParamText(params?.done)
  const total = toParamText(params?.total)
  const market = roomStatus.value.get('store')?.subject

  if (run === undefined || done === undefined || total === undefined || market === undefined) {
    return undefined
  }

  return {
    title: tr('ui.office.room.store'),
    lines: [tr('ui.office.tip.storeLine', { done, total, market })],
    go: jumpTo(run, tr('ui.office.common.seeKeeper')),
  }
}

function meetTip(): TipContent | undefined {
  const run = focusRunOf('meet')
  const line = debateLine(run)

  if (run === undefined || line === undefined) {
    return undefined
  }

  return {
    title: tr('ui.office.tip.meet'),
    lines: [line],
    go: jumpTo(run, tr('ui.office.chat.link.debate')),
  }
}

function resultsTip(): TipContent | undefined {
  const count = unseenCalls.value.length

  if (count === 0) {
    return undefined
  }

  return {
    title: tr('ui.office.tip.results'),
    lines: [
      tr(pluralKey(count, 'ui.office.tip.resultsLineOne', 'ui.office.tip.resultsLine'), { count }),
    ],
  }
}

function clockTip(): TipContent | undefined {
  const next = agenda.value.next

  if (next === undefined) {
    return undefined
  }

  return {
    title: tr('ui.office.tip.clock'),
    lines: [tr('ui.office.tip.clockLine', { job: next.label, when: next.time })],
  }
}

function alertsTip(): TipContent | undefined {
  const { alerts, stops } = alertCounts.value
  const task = alertsTask.value
  const timeZone = state.value?.timeZone

  if (alerts === undefined || stops === undefined || task?.everyMs === undefined) {
    return undefined
  }

  const seconds = Math.round(task.everyMs / MS_PER_SECOND)
  const lastRun =
    task.lastRunAt === undefined || timeZone === undefined
      ? []
      : [tr('ui.office.jobs.lastRun', { time: formatClock(task.lastRunAt, timeZone) })]

  return {
    title: tr('ui.office.room.alerts'),
    lines: [tr('ui.office.tip.alertsLine', { alerts, stops, seconds }), ...lastRun],
  }
}

function agendaTip(): TipContent | undefined {
  const next = agenda.value.next

  return next === undefined
    ? undefined
    : { title: tr('ui.office.agenda.title'), lines: [joinInline([next.time, next.label])] }
}
