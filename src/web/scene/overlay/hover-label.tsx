import type { MessageKey } from '@/i18n'
import type { ActorNow } from '@/web/scene/overlay/actor-state'
import type { ActorId, ActorStatus, Rect, SimView, Size } from '@/web/scene/types'
import type { Run } from '@/web/state/live'
import { actorNowOf } from '@/web/scene/overlay/actor-state'
import { tagTextOf } from '@/web/scene/overlay/name-tags'
import { sizeTag } from '@/web/scene/overlay/placement'
import { kidRoleIn } from '@/web/scene/overlay/team-pass'
import { useNow } from '@/web/state/clock'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatElapsed } from '@/web/text/time'
import { tr } from '@/web/text/tr'

const ELAPSED_TICK_MS = 1_000

/** What the dot over a head means, in words, so its colour is never the only cue. */
const STATUS_KEYS: Readonly<Record<ActorStatus, MessageKey>> = Object.freeze({
  free: 'ui.office.status.free',
  waiting: 'ui.office.status.waiting',
  failed: 'ui.office.status.failed',
} satisfies Record<ActorStatus, MessageKey>)

interface HoverLabelProps {
  readonly name: string
  readonly now: ActorNow
  readonly rect: Rect
}

/** The hovered or keyboard-focused person's name and one live line of what they do, its elapsed
 *  time ticking while it shows. */
export function HoverLabel({ name, now, rect }: HoverLabelProps) {
  const epochMs = useNow(ELAPSED_TICK_MS).value

  return (
    <span class="name-tag glass is-hover" style={{ left: `${rect.x}px`, top: `${rect.y}px` }}>
      {hoverTextOf(name, now, epochMs)}
    </span>
  )
}

/** The label the layout places beside a figure: what it says now, and its size. */
interface HoverPlace {
  readonly actor: ActorId
  readonly name: string
  readonly now: ActorNow
  readonly text: string
  readonly label: { anchor: Rect; size: Size }
}

/** The hovered or keyboard-focused person's label, beside their figure (CSS px) when on screen. */
export function hoverPlaceOf(
  sim: SimView,
  at: { readonly actor: ActorId | undefined; readonly figures: ReadonlyMap<ActorId, Rect> }
): HoverPlace | undefined {
  const { actor } = at
  const figure = actor === undefined ? undefined : at.figures.get(actor)

  if (actor === undefined || figure === undefined) {
    return undefined
  }

  const name = personNameOf(sim, actor)
  const now = actorNowOf(sim, actor)
  const text = hoverTextOf(name, now, Date.now())

  return { actor, name, now, text, label: { anchor: figure, size: sizeTag(text) } }
}

/** A person's name as their tag shows it; a child by the role its parent gave it. */
export function personNameOf(sim: SimView, actor: ActorId): string {
  return tagTextOf(actor, false, kidRoleIn(sim, actor))
}

/** A person's name and what they do now: their run and where it came from (or its step and how
 *  long it has run), what waits on you or for its turn, the office life's moment, else their dot. */
export function hoverTextOf(name: string, now: ActorNow, epochMs: number): string {
  return joinInline([name, lineOf(now, epochMs)])
}

/** What a person answers when the operator clicks them, from what they really do. */
export function replyTextOf(now: ActorNow): string {
  switch (now.kind) {
    case 'paused':
      return tr('ui.office.ix.paused')
    case 'asking':
      return tr('ui.office.ix.waiting', { what: now.what })
    case 'queued':
      return tr('ui.office.ix.queued')
    case 'busy':
      return tr('ui.office.ix.busy', { what: formatRunName(now.run) })
    default:
      return tr('ui.office.ix.free')
  }
}

function lineOf(now: ActorNow, epochMs: number): string {
  switch (now.kind) {
    case 'paused':
      return tr('ui.office.ix.paused')
    case 'asking':
      return tr('ui.office.label.waitingYou', { what: now.what })
    case 'queued':
      return tr('ui.office.label.queued', { what: now.what })
    case 'busy':
      return runLineOf(now.run, epochMs)
    case 'life':
      return now.line
    case 'dot':
      return tr(STATUS_KEYS[now.status])
  }
}

// A run that counts its steps says which one and for how long; any other says where it came from.
function runLineOf(run: Run, epochMs: number): string {
  const step = run.progress?.params?.step
  const total = run.progress?.params?.total

  if (typeof step === 'number' && typeof total === 'number') {
    return tr('ui.office.label.step', {
      n: step,
      total,
      elapsed: formatElapsed(epochMs - run.startedAt),
    })
  }

  return tr('ui.office.label.from', {
    what: formatRunName(run),
    source: sourceLabel(run.channelId),
  })
}
