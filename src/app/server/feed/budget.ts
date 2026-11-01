import type { FeedDeps } from '@/app/server/feed/relay'
import type { BusEventMap } from '@/core/events'
import type { Locale } from '@/core/types/locale'
import { NOTED_NORMALIZERS } from '@/app/server/ws/wire-events'
import { t } from '@/i18n'

/** A spent cap reaches the page once, from the feed. The soft warning is relayed per socket; this
 *  one is not, so a socket never hears it twice. */
export function followBudget({ bus, broadcast, locale }: FeedDeps): (() => void)[] {
  return [
    bus.on('budget_exhausted', (e) => {
      broadcast(NOTED_NORMALIZERS.budget_exhausted(e, toBudgetNote(e, locale)))
    }),
  ]
}

export function toBudgetNote(e: BusEventMap['budget_exhausted'], locale: Locale): string {
  return t(locale, e.period === 'daily' ? 'errors.budgetDaily' : 'errors.budgetMonthly')
}
