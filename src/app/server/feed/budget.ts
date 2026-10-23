import type { WireEvent } from '@/app/server/wire/events'
import type { BusEventMap, EventBus } from '@/core/events'
import type { Locale } from '@/core/types/locale'
import { NOTED_NORMALIZERS } from '@/app/server/ws/wire-events'
import { t } from '@/i18n'

interface BudgetFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
  readonly locale: Locale
}

/** A spent cap reaches the page once, from the feed. The soft warning is relayed per socket; this
 *  one is not, so a socket never hears it twice. */
export function followBudget({ bus, broadcast, locale }: BudgetFeedDeps): (() => void)[] {
  return [
    bus.on('budget_exhausted', (e) => {
      broadcast(NOTED_NORMALIZERS.budget_exhausted(e, toBudgetNote(e, locale)))
    }),
  ]
}

export function toBudgetNote(e: BusEventMap['budget_exhausted'], locale: Locale): string {
  return t(locale, e.period === 'daily' ? 'errors.budgetDaily' : 'errors.budgetMonthly')
}
