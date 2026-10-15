import type {
  ActiveAlert,
  Alert,
  AlertState,
  DeliveringAlert,
  FiredAlert,
  LeaseToken,
} from '@/trading/features/alerts/types'
import type { AlertCondition } from '@/trading/kernel/operator/alert'
import { channelId } from '@/core/channels'
import { StorageError } from '@/core/errors'
import { ALERT_STATES, alertOrigin } from '@/trading/features/alerts/types'
import { DELIVERY_ERROR_CODES } from '@/trading/kernel/caveat'
import { ticker as brandTicker, marketRef } from '@/trading/kernel/instrument'
import { ALERT_CONDITIONS, alertId as brandAlertId } from '@/trading/kernel/operator/alert'
import { toMember } from '@/trading/kernel/store/store-payload'
import { requireColumn } from '@/trading/kernel/store/store-row'

type AlertInState<TState extends AlertState> = Extract<Alert, { readonly state: TState }>

export interface AlertRow {
  readonly id: string
  readonly market: string
  readonly ticker: string
  readonly condition: string
  readonly threshold: number
  readonly channel: string
  readonly chat_id: string
  readonly state: string
  readonly origin: string | null
  readonly created_at: number
  readonly triggered_at: number | null
  readonly observed_price: number | null
  readonly next_due_at: number | null
  readonly attempts: number
  readonly lease_token: string | null
  readonly lease_until: number | null
  readonly last_error_code: string | null
  readonly fired_at: number | null
  readonly disabled_at: number | null
}

export function toAlert(row: AlertRow): Alert {
  const state = toMember<AlertState>(row.state, ALERT_STATES, 'alert state')
  const base = {
    id: brandAlertId(row.id),
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    condition: toMember<AlertCondition>(row.condition, ALERT_CONDITIONS, 'alert condition'),
    threshold: row.threshold,
    delivery: { channel: channelId(row.channel), chatId: row.chat_id },
    ...(row.origin === null ? {} : { origin: alertOrigin(row.origin) }),
    createdAt: row.created_at,
  }

  if (state === 'active') {
    return { ...base, state }
  }

  if (state === 'disabled') {
    return { ...base, state, disabledAt: readColumn(row.disabled_at, row, 'disabled_at') }
  }

  const triggered = {
    triggeredAt: readColumn(row.triggered_at, row, 'triggered_at'),
    observedPrice: readColumn(row.observed_price, row, 'observed_price'),
  }

  if (state === 'fired') {
    return { ...base, state, ...triggered, firedAt: readColumn(row.fired_at, row, 'fired_at') }
  }

  if (state === 'delivering') {
    return {
      ...base,
      state,
      ...triggered,
      attempts: row.attempts,
      leaseToken: toLeaseToken(row),
      leaseUntil: readColumn(row.lease_until, row, 'lease_until'),
    }
  }

  return {
    ...base,
    state,
    ...triggered,
    attempts: row.attempts,
    nextAttemptAt: readColumn(row.next_due_at, row, 'next_due_at'),
    ...(row.last_error_code === null
      ? {}
      : { lastErrorCode: toMember(row.last_error_code, DELIVERY_ERROR_CODES, 'delivery error') }),
  }
}

export function toActiveAlert(row: AlertRow): ActiveAlert {
  return alertInState(row, 'active', 'an active row')
}

export function toDeliveringAlert(row: AlertRow): DeliveringAlert {
  return alertInState(row, 'delivering', 'a claimed row')
}

export function toFiredAlert(row: AlertRow): FiredAlert {
  return alertInState(row, 'fired', 'a fired row')
}

/** A row read back in a state the caller's next step cannot use is a store invariant broken, not a
 *  case to handle: the query that fetched it already said which state it was asking for. */
function alertInState<TState extends AlertState>(
  row: AlertRow,
  state: TState,
  wanted: string
): AlertInState<TState> {
  const alert = toAlert(row)

  if (!isAlertInState(alert, state)) {
    throw new StorageError(`alert ${row.id} is ${alert.state} where ${wanted} was required`)
  }

  return alert
}

function isAlertInState<TState extends AlertState>(
  alert: Alert,
  state: TState
): alert is AlertInState<TState> {
  return alert.state === state
}

function toLeaseToken(row: AlertRow): LeaseToken {
  // why-safe: the row is in `delivering`, whose CHECK requires a token this store itself minted.
  return readColumn(row.lease_token, row, 'lease_token') as LeaseToken
}

function readColumn<T>(value: T | null, row: AlertRow, column: string): T {
  return requireColumn(value, `alert ${row.id} is ${row.state} without ${column}`)
}
