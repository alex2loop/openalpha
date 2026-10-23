import type { Locale } from '@/core/types/locale'
import type { DeliveringAlert } from '@/trading/features/alerts/types'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { IntradayReport } from '@/trading/features/market-data/intraday/types'
import type {
  CurrencyCode,
  InstrumentRef,
  PriceDisplay,
  QuoteUnit,
  Ticker,
} from '@/trading/kernel/instrument'
import type { AlertCondition, AlertId } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'

interface AlertQuote {
  readonly currency: CurrencyCode
  readonly unit?: QuoteUnit
  readonly display?: PriceDisplay
}

export const NOTICE_KINDS = Object.freeze([
  'price-alert',
  'exit-alert',
  'screener-alert',
  'brief',
  'intraday',
  'exit-plan',
  'stop-raised',
  'series-restated',
  'exit-filled',
] as const)

export type NoticeKind = (typeof NOTICE_KINDS)[number]

export type TradingNoticePayload =
  /** `quote` is read at send time and absent for a level or a failed read. */
  | {
      readonly kind: 'price-alert'
      readonly alert: DeliveringAlert
      readonly quote?: AlertQuote
    }
  | {
      readonly kind: 'exit-alert'
      readonly alert: DeliveringAlert
      readonly quote?: AlertQuote
    }
  /** `session` is absent when the read failed or the session is shut. */
  | {
      readonly kind: 'screener-alert'
      readonly alert: DeliveringAlert
      readonly quote?: AlertQuote
      readonly session?: {
        readonly movePct: number
        readonly benchmark?: { readonly ticker: Ticker; readonly movePct: number }
      }
    }
  /** `sentAfterOpen`: the build outlasted the open, so the brief carries a late-send line first. */
  | { readonly kind: 'brief'; readonly snapshot: BriefSnapshot; readonly sentAfterOpen?: true }
  | { readonly kind: 'intraday'; readonly report: IntradayReport }
  /** Levels the system set for a held name nothing was watching, or a held plan's stop the trail
   *  raised. Not a call, so neither carries a verdict: the levels are the whole message. Rendered by
   *  the arming pass, in the locale this notice is addressed with, because the kernel may not reach
   *  into a feature's own row to print one. */
  | { readonly kind: 'exit-plan'; readonly lines: readonly string[] }
  | { readonly kind: 'stop-raised'; readonly lines: readonly string[] }
  /** A name whose price history the provider re-adjusted, usually an ex-date. The plans priced on
   *  the old basis are closed, and the next tick writes new ones. */
  | { readonly kind: 'series-restated'; readonly tickers: readonly string[] }
  /** A resting stop or take-profit filled at the exchange and is in the ledger. `closeReason` is
   *  typed inline because the kernel may not reach into the ledger feature for its own type. */
  | {
      readonly kind: 'exit-filled'
      readonly fill: {
        readonly instrument: InstrumentRef
        readonly venue: string
        readonly quantity: number
        readonly unitPrice: number
        readonly currency: CurrencyCode
        readonly closeReason?: 'stop' | 'target'
      }
    }
  // Terminal, and named by what stopped: the operator re-enables it through that subject's tool.
  | { readonly kind: 'delivery-disabled'; readonly subject: NoticeKind }
  // The daemon was down through today's pre-open window, so today's was skipped; the next is still
  // on schedule.
  | { readonly kind: 'delivery-missed'; readonly subject: NoticeKind }
  // One scheduled delivery given up: the subscription stays on and the next one is still due.
  | { readonly kind: 'delivery-skipped'; readonly subject: NoticeKind }
  // One scheduled delivery given up because a key variable is unset: retrying cannot help, since a
  // key arrives with a restart, so it names the variable instead of reporting failed tries.
  | { readonly kind: 'key-missing'; readonly subject: NoticeKind; readonly env: string }
  // A background loop stopped on an error that is this code being wrong. `retryInMs` is absent once
  // the loop has used its restarts and stays stopped until the daemon restarts.
  | { readonly kind: 'loop-quarantined'; readonly operation: string; readonly retryInMs?: number }

export type ExitFillPayload = Extract<TradingNoticePayload, { readonly kind: 'exit-filled' }>

/** One fill the book now holds, handed to whoever wants to show it. */
export interface OrderFill {
  readonly instrument: InstrumentRef
  readonly venue: string
  readonly side: 'buy' | 'sell'
  readonly quantity: number
  readonly unitPrice: number
  readonly currency: CurrencyCode
  readonly closeReason?: 'stop' | 'target'
  readonly at: number
}

/** Called synchronously, and guarded by the caller: a listener that throws never fails the
 *  booking. */
export type OrderFilledListener = (fill: OrderFill) => void

/** An alert that is about to be sent for the first time, with what made it fire. `event` is which
 *  kind of alert it was: an exit's stop or target, a name the operator armed, a screener band. */
export interface AlertFired {
  readonly alertId: AlertId
  readonly event: 'stop' | 'target' | 'price' | 'mover'
  readonly instrument: InstrumentRef
  readonly condition: AlertCondition
  readonly threshold: number
  readonly observedPrice: number
  readonly firedAt: number
}

/** Called synchronously, once per alert, and guarded by the caller: a listener that throws never
 *  fails the delivery. */
export type AlertFiredListener = (fired: AlertFired) => void

export interface TradingNotice {
  readonly target: DeliveryAddress
  readonly locale: Locale
  readonly payload: TradingNoticePayload
}

export type TradingNoticeSendResult = 'accepted' | 'unavailable' | 'aborted' | 'revoked'

export interface TradingNoticeSender {
  send(notice: TradingNotice, signal: AbortSignal): Promise<TradingNoticeSendResult>
  /** Where an unattended notice armed from `origin` would be sent, or undefined when no route
   *  exists, a chat whose pairing was revoked included. A subscription armed at an address no
   *  channel runtime serves fails every attempt in silence and then disables itself, so the arming
   *  paths ask before they write. The terminal is no route of its own: it resolves to the chat the
   *  daemon would use. Read at arming time, never in place of a send result: a channel can go down
   *  afterwards, which is what the retry ladder is for. */
  resolveRecipient(origin: DeliveryAddress): Promise<DeliveryAddress | undefined>
}
