import { type ReadonlySignal, signal } from '@preact/signals'

import type { LitScreen } from '@/web/scene/overlay/screens'
import type { ScreenLine } from '@/web/scene/overlay-types'
import type { ActorId } from '@/web/scene/types'
import { AMBIENT_FX_GAP_MS } from '@/web/scene/budgets'

// The mockup's typing: two to four characters a tick.
const TYPE_TICK_MS = 65
const CHARS_MIN = 2
const CHARS_SPAN = 3

const typed = signal<ReadonlyMap<ActorId, number>>(new Map())

/** How many characters of its last line each lit screen has typed, by person. A screen without a
 *  terminal has none; a line the screen already held is not typed again. */
export const typedChars: ReadonlySignal<ReadonlyMap<ActorId, number>> = typed

/** One line being typed: which, and the beat it began on. */
interface Typing {
  readonly key: string
  readonly startMs: number
}

/** The typing of the lit screens: it moves on the ambient clock, a beat at a time, and holds no
 *  timer of its own. */
export interface ScreenTyping {
  /** Types on to the ambient beat `beatMs` (every line whole under reduced motion). */
  step(
    screens: readonly LitScreen[],
    at: { readonly beatMs: number; readonly isReduced: boolean }
  ): void
  /** The next beat while a line is still being typed, `Infinity` once all are done. */
  nextDueAt(): number
  /** Forgets every screen: the scene is going. */
  clear(): void
}

export function createScreenTyping(): ScreenTyping {
  const state: TypingState = { held: new Map(), dueAt: Number.POSITIVE_INFINITY }

  return {
    step: (screens, at) => stepTyping(state, screens, at),
    nextDueAt: () => state.dueAt,
    clear: () => {
      state.held = new Map()
      state.dueAt = Number.POSITIVE_INFINITY
      typed.value = new Map()
    },
  }
}

interface TypingState {
  held: ReadonlyMap<ActorId, Typing>
  dueAt: number
}

function stepTyping(
  state: TypingState,
  screens: readonly LitScreen[],
  at: { readonly beatMs: number; readonly isReduced: boolean }
): void {
  const held = new Map<ActorId, Typing>()
  const chars = new Map<ActorId, number>()
  let isTyping = false

  for (const screen of screens) {
    const last = lastLineOf(screen)

    if (last === undefined) {
      continue
    }

    const key = `${screen.runId}|${last.id}`
    const before = state.held.get(screen.actor)
    const own = before?.key === key ? before : { key, startMs: at.beatMs }
    const ticks = Math.floor((at.beatMs - own.startMs) / TYPE_TICK_MS)
    const count = at.isReduced ? last.text.length : typedAfter(last.text, ticks)

    held.set(screen.actor, own)
    chars.set(screen.actor, count)
    isTyping = isTyping || count < last.text.length
  }

  state.held = held
  state.dueAt = isTyping ? at.beatMs + AMBIENT_FX_GAP_MS : Number.POSITIVE_INFINITY

  if (!isSame(typed.peek(), chars)) {
    typed.value = chars
  }
}

function lastLineOf(screen: LitScreen): ScreenLine | undefined {
  return screen.content.kind === 'line' ? undefined : screen.content.lines.at(-1)
}

// The characters of `text` typed after `ticks` ticks.
function typedAfter(text: string, ticks: number): number {
  let count = 0

  for (let tick = 0; tick < ticks && count < text.length; tick++) {
    count += CHARS_MIN + ((count + tick) % CHARS_SPAN)
  }

  return Math.min(text.length, count)
}

function isSame(a: ReadonlyMap<ActorId, number>, b: ReadonlyMap<ActorId, number>): boolean {
  return a.size === b.size && [...b].every(([actor, count]) => a.get(actor) === count)
}
