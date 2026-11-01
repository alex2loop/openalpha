import type { ActivityRowWire } from '@/app/server/wire/activity'
import { pluralKey } from '@/i18n'
import { formatUsd } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

/** "gồm N agent con {cost}": what a parent's direct children spent of its whole. */
export function formatChildrenLine(children: readonly ActivityRowWire[]): string {
  return tr(
    pluralKey(children.length, 'ui.office.cost.withChildrenOne', 'ui.office.cost.withChildren'),
    {
      count: children.length,
      cost: formatUsd(children.reduce((sum, child) => sum + child.costUsd, 0)),
    }
  )
}
