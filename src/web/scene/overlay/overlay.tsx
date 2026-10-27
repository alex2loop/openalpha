import { type ReadonlySignal, signal } from '@preact/signals'

import type { ActorNow } from '@/web/scene/overlay/actor-state'
import type { Marker } from '@/web/scene/overlay/markers'
import type { PlacedTag } from '@/web/scene/overlay/name-tags'
import type { Placed } from '@/web/scene/overlay/placement'
import type { LitScreen } from '@/web/scene/overlay/screens'
import type { CardPlace } from '@/web/scene/overlay/team-pass'
import type { ActorId, Rect } from '@/web/scene/types'
import { boxStyle } from '@/web/scene/overlay/box-style'
import { DeskScreen } from '@/web/scene/overlay/desk-screen'
import { HoverLabel } from '@/web/scene/overlay/hover-label'
import { NameTags, roleTitleOf, tagTextOf } from '@/web/scene/overlay/name-tags'
import { childRunIdOf, rosterDefOf } from '@/web/scene/sim/actors/roster'
import { childRoleOf } from '@/web/scene/sim/team/goals'
import { findRun } from '@/web/state/live'
import { reducedMotion, sceneView } from '@/web/state/prefs'
import { ATTENTION_MARK } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'
import { BELL_POPOVER_ID, openPopover } from '@/web/ui/kit/popover'

import './overlay.css'

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
  // The 3D scene draws the lit screens and the marks itself; a mark's text stays for readers.
  const isInScene = sceneView.value === '3d'

  return (
    <div class="scene-overlay">
      {!isInScene &&
        view.screens.map(({ screen, rect }) => (
          <DeskScreen key={screen.actor} screen={screen} rect={rect} />
        ))}
      <Marks markers={view.markers} isInScene={isInScene} />
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

// Each "!" over a person; in 3D the scene draws it, and the page keeps its text for readers.
function Marks({
  markers,
  isInScene,
}: {
  readonly markers: OverlayView['markers']
  readonly isInScene: boolean
}) {
  return markers.map(({ marker, rect }) => (
    <span
      key={marker.actor}
      class={[
        'marker',
        `marker-${marker.tone}`,
        reducedMotion.value ? 'is-still' : '',
        isInScene ? 'is-in-scene' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={boxStyle(rect)}
    >
      {ATTENTION_MARK}
    </span>
  ))
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
  const handle = openModal({
    title: speakerOf(bubble.actor),
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

// A built-in person by its role; an own agent or a child as its name tag reads.
function speakerOf(actor: ActorId): string {
  const def = rosterDefOf(actor)

  if (def !== undefined) {
    return roleTitleOf(def.role)
  }

  const runId = childRunIdOf(actor)
  const title = runId === undefined ? undefined : findRun(runId)?.title

  return tagTextOf(actor, false, title === undefined ? undefined : childRoleOf(title))
}
