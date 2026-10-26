import type { RefObject } from 'preact'
import { computed, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { isWaitingNotice, needsYou, notices, unread, unreadStops } from '@/web/state/notices'
import { reducedMotion } from '@/web/state/prefs'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { BellIcon } from '@/web/ui/kit/icons'
import { BELL_POPOVER_ID, openPopoverId, togglePopover } from '@/web/ui/kit/popover'

import './bell.css'

// Past this the badge reads "9+".
const BADGE_MAX = 9

// Unread requests still waiting: counted in `needsYou` and shown as cards, not as rows.
const unreadWaiting = computed(
  () =>
    notices.value.filter((notice) => notice.readAt === undefined && isWaitingNotice(notice)).length
)
// Unread rows that do not need the operator: a dot, not a number.
const otherUnread = computed(() =>
  Math.max(0, (unread.value ?? 0) - unreadStops.value - unreadWaiting.value)
)

/** The bell: a number for what needs the operator (red when a stop broke, amber otherwise), a dot
 *  for other news. A new item bumps the badge once; never a toast. */
export function BellButton({ anchor }: { readonly anchor: RefObject<HTMLButtonElement | null> }) {
  const label = buildLabel(needsYou.value, otherUnread.value)

  return (
    <button
      ref={anchor}
      type="button"
      class="bell-button"
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={openPopoverId.value === BELL_POPOVER_ID}
      onClick={() => togglePopover(BELL_POPOVER_ID)}
    >
      <BellIcon />
      <BellBadge />
    </button>
  )
}

function BellBadge() {
  const need = needsYou.value
  const read = unread.value
  const bumpSeq = useBump(read === undefined ? undefined : need + read)

  if (need > 0) {
    const tone = unreadStops.value > 0 ? 'is-stop' : 'is-need'

    return (
      <span key={bumpSeq} class={`bell-badge ${tone}${bumpSeq > 0 ? ' is-bump' : ''}`}>
        {need > BADGE_MAX ? `${BADGE_MAX}+` : need}
      </span>
    )
  }

  if (otherUnread.value > 0) {
    return <span key={bumpSeq} class={`bell-badge is-dot${bumpSeq > 0 ? ' is-bump' : ''}`} />
  }

  return null
}

// A new key remounts the badge, which plays its bump once. `total` is absent until the bell's first
// read, and that first reading never bumps.
function useBump(total: number | undefined): number {
  const previous = useRef<number | undefined>(undefined)
  const seq = useSignal(0)

  useEffect(() => {
    const before = previous.current

    previous.current = total

    if (before !== undefined && total !== undefined && total > before && !reducedMotion.value) {
      seq.value++
    }
  }, [total, seq])

  return seq.value
}

function buildLabel(need: number, other: number): string {
  const head =
    need > 0
      ? tr(pluralKey(need, 'ui.office.header.bellNeedOne', 'ui.office.header.bellNeed'), {
          count: need,
        })
      : tr('ui.office.header.bell')

  if (other === 0) {
    return head
  }

  return joinInline([
    head,
    tr(pluralKey(other, 'ui.office.header.bellMoreOne', 'ui.office.header.bellMore'), {
      count: other,
    }),
  ])
}
