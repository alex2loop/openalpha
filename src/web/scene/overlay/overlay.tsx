import { type ReadonlySignal, signal } from '@preact/signals'

import type { ActorNow } from '@/web/scene/overlay/actor-state'
import type { Marker } from '@/web/scene/overlay/markers'
import type { PlacedTag } from '@/web/scene/overlay/name-tags'
import type { Placed } from '@/web/scene/overlay/placement'
import type { LitScreen } from '@/web/scene/overlay/screens'
import type { CardPlace } from '@/web/scene/overlay/team-pass'
import type { ActorId, Rect } from '@/web/scene/types'
import { HoverLabel } from '@/web/scene/overlay/hover-label'
import { NameTags, roleTitleOf } from '@/web/scene/overlay/name-tags'
import { rosterDefOf } from '@/web/scene/sim/actors/roster'
import { reducedMotion } from '@/web/state/prefs'
import { ATTENTION_MARK } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'
import { BELL_POPOVER_ID, openPopover } from '@/web/ui/kit/popover'

import './overlay.css'

// Below this width a lit screen glows without its words.
const SCREEN_TEXT_MIN_PX = 64
// The price line's drawing box; the svg stretches it over the screen.
const LINE_BOX_W = 100
const LINE_BOX_H = 40

/** Everything the overlay shows, in CSS px of the scene host, as the last layout placed it. */
export interface OverlayView {
  readonly bubbles: readonly Placed[]
  readonly tags: readonly PlacedTag[]
  readonly markers: readonly { readonly marker: Marker; readonly rect: Rect }[]
  readonly screens: readonly { readonly screen: LitScreen; readonly rect: Rect }[]
  /** An own agent's card over its head, on the team floor. */
  readonly cards: readonly CardPlace[]
  /** "+ Thêm agent" on the next free desk of the team floor. */
  readonly addDesk?: Rect
  readonly hover?: {
    readonly actor: ActorId
    readonly name: string
    readonly rect: Rect
    readonly now: ActorNow
  }
  /** Rings under the feet of the people picked for a meeting and the one the keyboard is on. */
  readonly rings: readonly {
    readonly actor: ActorId
    readonly rect: Rect
    readonly isKey: boolean
  }[]
  /** The person whose radial menu is open, by their figure. */
  readonly menu?: { readonly actor: ActorId; readonly rect: Rect }
}

export const EMPTY_OVERLAY: OverlayView = Object.freeze({
  bubbles: [],
  tags: [],
  markers: [],
  screens: [],
  cards: [],
  rings: [],
})

const shown = signal<OverlayView>(EMPTY_OVERLAY)
const hovered = signal<ActorId | undefined>(undefined)
const keyed = signal<ActorId | undefined>(undefined)
const spoken = signal('')

/** What the overlay shows; written only by its layout pass, read by the hit test. */
export const overlayView: ReadonlySignal<OverlayView> = shown
/** The person under the pointer, whose name label shows beside them. */
export const hoveredActor: ReadonlySignal<ActorId | undefined> = hovered
/** The person Tab or an arrow key stepped to on the canvas. */
export const keyedActor: ReadonlySignal<ActorId | undefined> = keyed
/** The scene's latest line for screen readers; the page's announcer speaks it. */
export const sceneSpoken: ReadonlySignal<string> = spoken

export function showOverlay(next: OverlayView): void {
  shown.value = next
}

export function hoverActor(id: ActorId | undefined): void {
  if (hovered.value !== id) {
    hovered.value = id
  }
}

export function keyActor(id: ActorId | undefined): void {
  keyed.value = id
}

/** Says `text` to screen readers once, through the page's polite live region. */
export function announce(text: string): void {
  spoken.value = text
}

/** The scene's DOM overlay: lit screens, markers, name tags, the hover label and the bubbles.
 *  Only a bubble's buttons take the pointer; every other piece is reached through the canvas's hit
 *  test. */
export function SceneOverlay() {
  const view = shown.value

  return (
    <div class="scene-overlay">
      {view.screens.map(({ screen, rect }) => (
        <DeskScreen key={screen.actor} screen={screen} rect={rect} />
      ))}
      {view.markers.map(({ marker, rect }) => (
        <span
          key={marker.actor}
          class={`marker marker-${marker.tone}${reducedMotion.value ? ' is-still' : ''}`}
          style={boxStyle(rect)}
        >
          {ATTENTION_MARK}
        </span>
      ))}
      {view.rings.map((ring) => (
        <span
          key={ring.actor}
          class={ring.isKey ? 'pick-ring is-key' : 'pick-ring'}
          style={boxStyle(ring.rect)}
        />
      ))}
      <NameTags tags={view.tags} />
      {view.hover !== undefined && (
        <HoverLabel name={view.hover.name} now={view.hover.now} rect={view.hover.rect} />
      )}
      {view.bubbles.map((placed) => (
        <BubbleView key={placed.bubble.id} placed={placed} />
      ))}
    </div>
  )
}

function DeskScreen({ screen, rect }: { readonly screen: LitScreen; readonly rect: Rect }) {
  const { content } = screen

  if (content.kind === 'line') {
    return (
      <span class="desk-screen" style={boxStyle(rect)} title={content.ticker}>
        <svg
          viewBox={`0 0 ${LINE_BOX_W} ${LINE_BOX_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={toPoints(content.closes)} />
        </svg>
      </span>
    )
  }

  const line = tr('ui.office.screen.reading', { host: content.host })

  return (
    <span class="desk-screen" style={boxStyle(rect)} title={line}>
      {rect.w >= SCREEN_TEXT_MIN_PX ? line : null}
    </span>
  )
}

function BubbleView({ placed }: { readonly placed: Placed }) {
  const { bubble, rect, side, tailX } = placed
  const isCut = bubble.full !== bubble.text

  return (
    <div
      class={`bubble bubble-${bubble.kind} side-${side}${bubble.isBright === true ? ' is-bright' : ''}`}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        '--tail-x': `${tailX}px`,
      }}
    >
      <p class="bubble-text">{bubble.text}</p>
      {bubble.footer !== undefined && <p class="bubble-foot">{bubble.footer}</p>}
      {(bubble.kind === 'wait' || isCut) && (
        <div class="bubble-actions">
          {bubble.kind === 'wait' && (
            <button type="button" onClick={() => openPopover(BELL_POPOVER_ID)}>
              {tr('ui.office.bubble.open')}
            </button>
          )}
          {isCut && (
            <button type="button" onClick={() => openWhole(placed)}>
              {tr('ui.office.bubble.more')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// The whole of a cut line, with its footer, under its speaker's name.
function openWhole({ bubble }: Placed): void {
  const def = rosterDefOf(bubble.actor)
  const handle = openModal({
    title: def === undefined ? '' : roleTitleOf(def.role),
    body: (
      <div class="bubble-whole">
        <p>{bubble.full}</p>
        {bubble.footer !== undefined && <p class="meta">{bubble.footer}</p>}
      </div>
    ),
    footer: (
      <Button kind="commit" onClick={() => handle.close()}>
        {tr('ui.office.common.close')}
      </Button>
    ),
  })
}

function boxStyle(rect: Rect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  }
}

// The closes scaled into the line's box, the lowest at the bottom.
function toPoints(closes: readonly number[]): string {
  const low = Math.min(...closes)
  const span = Math.max(...closes) - low || 1
  const stepX = LINE_BOX_W / Math.max(1, closes.length - 1)

  return closes
    .map((close, index) => `${index * stepX},${LINE_BOX_H - ((close - low) / span) * LINE_BOX_H}`)
    .join(' ')
}
