import type { MessageKey } from '@/i18n'
import type { LifeLine } from '@/web/scene/types'
import { roomTagOf } from '@/web/scene/overlay/room-tags'
import { tr } from '@/web/text/tr'

// The lines that say one fixed thing.
const LIFE_KEYS = Object.freeze({
  lunch: 'ui.office.life.lunch',
  coffee: 'ui.office.life.coffee',
  friday: 'ui.office.life.friday',
  standup: 'ui.office.life.standup',
  chat: 'ui.office.life.chat',
  rounds: 'ui.office.life.rounds',
  earnings: 'ui.office.rhythm.earnings',
  expiry: 'ui.office.rhythm.expiry',
} satisfies Partial<Record<LifeLine['label'], MessageKey>>)

/** What an office life moment says, in words. */
export function lifeTextOf(line: LifeLine): string {
  switch (line.label) {
    case 'due':
      return tr('ui.office.idle.due', { time: line.time, what: line.what })
    case 'roundCheck':
      return tr('ui.office.life.roundCheck', { room: roomTagOf(line.room, undefined).name })
    case 'closingAuction':
      return tr('ui.office.rhythm.closingAuction', { from: line.from, to: line.to })
    case 'drop':
      return tr('ui.office.rhythm.drop', { index: line.index })
    case 'exDividend':
      return tr('ui.office.rhythm.exDividend', { ticker: line.ticker })
    case 'overtime':
      return tr('ui.office.rhythm.overtime', { what: line.what })
    default:
      return tr(LIFE_KEYS[line.label])
  }
}
