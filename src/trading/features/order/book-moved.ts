import type { Locale } from '@/core/types/locale'
import type { CapRejection } from '@/trading/features/order/types'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import type { QuotedIn } from '@/trading/render/money'
import { renderCapRejections } from '@/trading/features/order/render'
import { OrderError } from '@/trading/features/order/types'
import { renderCapBreach } from '@/trading/render/exposure'

const REASON_SEPARATOR = ', '
const LINE_SEPARATOR = '\n'

export interface BookRefusals {
  readonly rejections: readonly CapRejection[]
  readonly breaches: readonly CapBreach[]
  readonly quotedIn: QuotedIn
}

/** The caps no longer allow an order the operator confirmed. The message is the machine codes, which
 *  is all a tool failure hands an agent; only `detail` writes the reasons in the operator's own
 *  words and figures. */
export class BookMovedError extends OrderError {
  constructor(private readonly refusals: BookRefusals) {
    super(
      'order.book_moved',
      [
        ...refusals.rejections.map((rejection) => rejection.code),
        ...refusals.breaches.map((breach) => breach.kind),
      ].join(REASON_SEPARATOR)
    )
  }

  override detail(locale: Locale): string {
    const { rejections, breaches, quotedIn } = this.refusals

    return [
      ...(rejections.length === 0 ? [] : [renderCapRejections(locale, rejections, quotedIn)]),
      ...breaches.map((breach) => renderCapBreach(locale, breach)),
    ].join(LINE_SEPARATOR)
  }
}
