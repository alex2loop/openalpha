import { pluralKey } from '@/i18n'
import { needsYou, unreadStops } from '@/web/state/notices'
import { joinInline, NEXT_GLYPH } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { BELL_POPOVER_ID, openPopover } from '@/web/ui/kit/popover'

/** "Cần bạn": shown only while something waits; "Mở" opens the bell. */
export function NeedsYou() {
  const total = needsYou.value

  if (total <= 0) {
    return null
  }

  const breaches = Math.min(total, unreadStops.value)

  return (
    <button type="button" class="needs-bar" onClick={() => openPopover(BELL_POPOVER_ID)}>
      <b>
        {tr(pluralKey(total, 'ui.office.today.needsOne', 'ui.office.today.needs'), {
          count: total,
        })}
      </b>
      <span class="block-grow">{joinInline(buildParts(total - breaches, breaches))}</span>
      <span>
        {tr('ui.office.today.needsOpen')} {NEXT_GLYPH}
      </span>
    </button>
  )
}

// What waits, by kind; a kind with nothing waiting is left out.
function buildParts(approvals: number, breaches: number): readonly string[] {
  const parts: string[] = []

  if (approvals > 0) {
    const key = pluralKey(
      approvals,
      'ui.office.today.needsApprovalsOne',
      'ui.office.today.needsApprovals'
    )

    parts.push(tr(key, { count: approvals }))
  }

  if (breaches > 0) {
    const key = pluralKey(
      breaches,
      'ui.office.today.needsBreachesOne',
      'ui.office.today.needsBreaches'
    )

    parts.push(tr(key, { count: breaches }))
  }

  return parts
}
