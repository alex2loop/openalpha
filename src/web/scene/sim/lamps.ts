import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { RoomId } from '@/web/scene/types'
import { isNightSun } from '@/web/scene/clock/sun'
import { moment } from '@/web/scene/sim/rhythm'
import { skyNow } from '@/web/scene/sim/sky'
import { lampsOff, nightLamps, setDayLamps, setNightLamps } from '@/web/state/prefs'

const lit = signal<ReadonlySet<RoomId>>(new Set())

/** After civil dusk, and all of a rest day, a lamp follows the switches made since and otherwise
 *  who is in; by day it follows its saved switch. The sun decides, never the office hours. */
export const isLampNight: ReadonlySignal<boolean> = computed(
  () => !moment.value.tradingDay || isNightSun(skyNow.value.light.sun)
)
/** The rooms the last drawn frame lit. */
export const litRooms: ReadonlySignal<ReadonlySet<RoomId>> = lit

export function isRoomLit(room: RoomId, occupied: ReadonlySet<RoomId>): boolean {
  return isLampNight.value
    ? (nightLamps.value.get(room) ?? occupied.has(room))
    : !lampsOff.value.has(room)
}

/** Keeps what the frame lit, written only when it changed. */
export function noteLitRooms(rooms: ReadonlySet<RoomId>): void {
  const held = lit.peek()

  if (rooms.size !== held.size || [...rooms].some((room) => !held.has(room))) {
    lit.value = rooms
  }
}

export function toggleLamp(room: RoomId): void {
  switchLamps([room], !lit.peek().has(room))
}

/** The master switch: every lamp off when any is lit, else every one on. */
export function toggleAllLamps(rooms: readonly RoomId[]): void {
  switchLamps(rooms, !rooms.some((room) => lit.peek().has(room)))
}

function switchLamps(rooms: readonly RoomId[], isOn: boolean): void {
  if (isLampNight.peek()) {
    setNightLamps(rooms, isOn)
  } else {
    setDayLamps(rooms, isOn)
  }
}
