import type { LeaseToken } from '@/trading/features/alerts/types'
import type {
  BriefDelivery,
  BriefDeliveryState,
  DeliveringBriefDelivery,
  DisableBriefResult,
  ScheduledBriefDelivery,
} from '@/trading/features/brief/types'
import type { DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { channelId } from '@/core/channels'
import { assertNotAborted, StorageError } from '@/core/errors'
import { BRIEF_DELIVERY_STATES } from '@/trading/features/brief/types'
import { claimDueRows } from '@/trading/features/suggestion/store/claim'
import { DELIVERY_ERROR_CODES } from '@/trading/kernel/caveat'
import { region as brandRegion, tradingDay } from '@/trading/kernel/instrument'
import { toMember } from '@/trading/kernel/store/store-payload'
import { requireColumn } from '@/trading/kernel/store/store-row'

/** The table holds exactly one row: one operator, one morning brief. */
const DELIVERY_ROW_ID = 1

const UPSERT_SQL =
  'INSERT INTO brief_delivery (id, region, channel, chat_id, send_time, ' +
  'state, next_delivery_day, next_due_at, attempts) VALUES '
const DUE_STATES = Object.freeze(['scheduled', 'delivering'] as const)
// Both lease-guarded transitions verify the day as well as the token: checking only the token
// would let a retry mark a lease against a different day than the one whose content was built.
const LEASE_PREDICATE = "state = 'delivering' AND lease_token = "
// A SET expression reads the row's pre-update values, so `delivery_day` here is the day that was
// actually delivered even though the same statement clears the column.
const DELIVERED_SET = 'last_delivered_day = delivery_day, attempts = 0, '
// A day given up on was never delivered, so `last_delivered_day` stays; the retry count resets so
// the next day starts its own ladder.
const ABANDONED_SET = 'attempts = 0, '

interface BriefDeliveryRow {
  readonly region: string
  readonly channel: string
  readonly chat_id: string
  readonly send_time: string | null
  readonly state: string
  readonly last_delivered_day: string | null
  readonly next_delivery_day: string | null
  readonly next_due_at: number | null
  readonly delivery_day: string | null
  readonly attempts: number
  readonly lease_token: string | null
  readonly lease_until: number | null
  readonly last_error_code: string | null
  readonly disabled_at: number | null
}

interface ClaimDeliveryOptions {
  readonly now: number
  readonly leaseToken: LeaseToken
  readonly leaseUntil: number
  readonly limit: number
  readonly signal: AbortSignal
}

interface CompleteDeliveryOptions {
  readonly leaseToken: LeaseToken
  readonly deliveryDay: TradingDay
  readonly nextDeliveryDay: TradingDay
  readonly nextDueAt: number
  readonly errorCode?: DeliveryErrorCode
  readonly signal: AbortSignal
}

interface ReleaseDeliveryOptions {
  readonly leaseToken: LeaseToken
  readonly deliveryDay: TradingDay
  readonly now: number
}

export interface BriefDeliveryStore {
  /** Enabling twice replaces the schedule rather than failing: there is one row to hold it, and an
   *  operator re-running `/brief enable 07:30` means the new time, not a conflict. `null` when a
   *  tick holds the row's lease: the write is refused in SQL, so the claim keeps it, as
   *  `reschedule` does. Scheduled in, scheduled out: the row is re-read after the upsert, and a
   *  concurrent disable is an error rather than a delivery to report. */
  enable(
    delivery: ScheduledBriefDelivery,
    signal: AbortSignal
  ): Promise<ScheduledBriefDelivery | null>
  find(signal: AbortSignal): Promise<BriefDelivery | null>
  /** Moves a still-scheduled row to a new send time, in one guarded write. False when the row is no
   *  longer scheduled: a tick that claimed it keeps its lease. */
  reschedule(delivery: ScheduledBriefDelivery, signal: AbortSignal): Promise<boolean>
  claimDue(options: ClaimDeliveryOptions): Promise<readonly DeliveringBriefDelivery[]>
  /** Records the delivered day and the service-computed next schedule in one guarded write. */
  markDelivered(options: CompleteDeliveryOptions): Promise<boolean>
  /** Retries the same day after a failed send. The claim already counted the attempt, so this is
   *  the one completion that leaves `attempts` alone. */
  deferDelivery(options: CompleteDeliveryOptions): Promise<boolean>
  /** Gives up the claimed day after its attempts ran out: the schedule moves to the next day with a
   *  fresh count, and the day is not recorded as delivered. */
  abandonDelivery(options: CompleteDeliveryOptions): Promise<boolean>
  disable(options: {
    readonly disabledAt: number
    readonly signal: AbortSignal
  }): Promise<DisableBriefResult>
  /** Undoes a claim whose delivery was aborted before it completed: back to `scheduled` with the
   *  bound day and the claim's attempt increment handed back. Takes no signal — this is the
   *  cleanup that runs while the tick's signal is already aborted. */
  release(options: ReleaseDeliveryOptions): Promise<boolean>
}

export function createBriefDeliveryStore(deps: StoreDeps): BriefDeliveryStore {
  return {
    enable: (delivery, signal) => enable(deps, delivery, signal),
    find: (signal) => find(deps, signal),
    reschedule: (delivery, signal) => reschedule(deps, delivery, signal),
    claimDue: (options) => claimDue(deps, options),
    markDelivered: (options) => completeDelivery(deps, options, DELIVERED_SET),
    deferDelivery: (options) => completeDelivery(deps, options, ''),
    abandonDelivery: (options) => completeDelivery(deps, options, ABANDONED_SET),
    disable: (options) => disable(deps, options),
    release: (options) => release(deps, options),
  }
}

/** An upsert, not an insert-or-conflict: re-enabling re-arms the one row from whatever state it
 *  was in, including `disabled`, and clears the retry state that state carried. Except `delivering`:
 *  clearing that lease mid-send would let the day be sent again, so the conflict update does not
 *  apply to it. The table is named in the guard because `state` alone is ambiguous with `excluded`
 *  on Postgres. */
async function enable(
  deps: StoreDeps,
  delivery: ScheduledBriefDelivery,
  signal: AbortSignal
): Promise<ScheduledBriefDelivery | null> {
  assertNotAborted(signal)

  const result = await deps.db.execute(
    `${UPSERT_SQL}(${deps.dialect.paramList(9)}) ON CONFLICT (id) DO UPDATE SET ` +
      'region = excluded.region, ' +
      'channel = excluded.channel, chat_id = excluded.chat_id, send_time = excluded.send_time, ' +
      'state = excluded.state, next_delivery_day = excluded.next_delivery_day, ' +
      'next_due_at = excluded.next_due_at, attempts = 0, delivery_day = NULL, ' +
      'lease_token = NULL, lease_until = NULL, last_error_code = NULL, disabled_at = NULL ' +
      "WHERE brief_delivery.state <> 'delivering'",
    [
      DELIVERY_ROW_ID,
      delivery.region,
      delivery.delivery.channel,
      delivery.delivery.chatId,
      delivery.sendTime ?? null,
      delivery.state,
      delivery.nextDeliveryDay,
      delivery.nextDueAt,
      0,
    ]
  )

  if (result.changes === 0) {
    return null
  }

  const stored = await find(deps, signal)

  if (stored === null) {
    throw new StorageError('brief delivery vanished immediately after being enabled')
  }

  if (stored.state !== 'scheduled') {
    throw new StorageError(`brief delivery is '${stored.state}' immediately after being enabled`)
  }

  return stored
}

async function reschedule(
  deps: StoreDeps,
  delivery: ScheduledBriefDelivery,
  signal: AbortSignal
): Promise<boolean> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE brief_delivery SET send_time = ${p(1)}, next_delivery_day = ${p(2)}, ` +
      `next_due_at = ${p(3)}, attempts = 0, last_error_code = NULL ` +
      `WHERE id = ${p(4)} AND state = 'scheduled'`,
    [delivery.sendTime ?? null, delivery.nextDeliveryDay, delivery.nextDueAt, DELIVERY_ROW_ID]
  )

  return result.changes === 1
}

async function find(deps: StoreDeps, signal: AbortSignal): Promise<BriefDelivery | null> {
  assertNotAborted(signal)

  const rows = await deps.db.query<BriefDeliveryRow>(
    `SELECT * FROM brief_delivery WHERE id = ${deps.dialect.param(1)}`,
    [DELIVERY_ROW_ID]
  )
  const row = rows[0]

  return row ? toDelivery(row) : null
}

async function claimDue(
  deps: StoreDeps,
  options: ClaimDeliveryOptions
): Promise<readonly DeliveringBriefDelivery[]> {
  const rows = await claimDueRows<BriefDeliveryRow>(deps, {
    table: 'brief_delivery',
    dueStates: DUE_STATES,
    claimState: 'delivering',
    deliveryDayColumn: 'delivery_day',
    now: options.now,
    leaseToken: options.leaseToken,
    leaseUntil: options.leaseUntil,
    limit: options.limit,
    signal: options.signal,
  })

  return rows.map(toDelivering)
}

async function completeDelivery(
  deps: StoreDeps,
  options: CompleteDeliveryOptions,
  deliveredSet: string
): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE brief_delivery SET state = 'scheduled', ${deliveredSet}` +
      `next_delivery_day = ${p(1)}, next_due_at = ${p(2)}, last_error_code = ${p(3)}, ` +
      'delivery_day = NULL, lease_token = NULL, lease_until = NULL ' +
      `WHERE id = ${p(4)} AND ${LEASE_PREDICATE}${p(5)} AND delivery_day = ${p(6)}`,
    [
      options.nextDeliveryDay,
      options.nextDueAt,
      options.errorCode ?? null,
      DELIVERY_ROW_ID,
      options.leaseToken,
      options.deliveryDay,
    ]
  )

  return result.changes === 1
}

// `next_delivery_day = delivery_day` reads the pre-update value, exactly reversing the claim's
// day binding.
async function release(deps: StoreDeps, options: ReleaseDeliveryOptions): Promise<boolean> {
  const p = deps.dialect.param
  const result = await deps.db.execute(
    "UPDATE brief_delivery SET state = 'scheduled', next_delivery_day = delivery_day, " +
      `next_due_at = ${p(1)}, attempts = attempts - 1, delivery_day = NULL, ` +
      'lease_token = NULL, lease_until = NULL ' +
      `WHERE id = ${p(2)} AND ${LEASE_PREDICATE}${p(3)} AND delivery_day = ${p(4)}`,
    [options.now, DELIVERY_ROW_ID, options.leaseToken, options.deliveryDay]
  )

  return result.changes === 1
}

async function disable(
  deps: StoreDeps,
  options: { readonly disabledAt: number; readonly signal: AbortSignal }
): Promise<DisableBriefResult> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE brief_delivery SET state = 'disabled', disabled_at = ${p(1)}, ` +
      'next_delivery_day = NULL, next_due_at = NULL, delivery_day = NULL, lease_token = NULL, ' +
      'lease_until = NULL ' +
      `WHERE id = ${p(2)} AND state <> 'disabled'`,
    [options.disabledAt, DELIVERY_ROW_ID]
  )

  if (result.changes === 1) {
    return 'disabled'
  }

  const existing = await find(deps, options.signal)

  return existing === null ? 'not-found' : 'already-disabled'
}

function toDelivery(row: BriefDeliveryRow): BriefDelivery {
  const state = toMember<BriefDeliveryState>(
    row.state,
    BRIEF_DELIVERY_STATES,
    'brief delivery state'
  )
  const base = {
    region: brandRegion(row.region),
    delivery: { channel: channelId(row.channel), chatId: row.chat_id },
    ...(row.send_time === null ? {} : { sendTime: row.send_time }),
    ...(row.last_delivered_day === null
      ? {}
      : { lastDeliveredDay: tradingDay(row.last_delivered_day) }),
  }

  if (state === 'disabled') {
    return { ...base, state, disabledAt: readColumn(row.disabled_at, row, 'disabled_at') }
  }

  if (state === 'delivering') {
    return {
      ...base,
      state,
      deliveryDay: tradingDay(readColumn(row.delivery_day, row, 'delivery_day')),
      attempts: row.attempts,
      leaseToken: toLeaseToken(row),
      leaseUntil: readColumn(row.lease_until, row, 'lease_until'),
    }
  }

  return {
    ...base,
    state,
    nextDeliveryDay: tradingDay(readColumn(row.next_delivery_day, row, 'next_delivery_day')),
    nextDueAt: readColumn(row.next_due_at, row, 'next_due_at'),
    attempts: row.attempts,
    ...(row.last_error_code === null
      ? {}
      : { lastErrorCode: toMember(row.last_error_code, DELIVERY_ERROR_CODES, 'delivery error') }),
  }
}

function toDelivering(row: BriefDeliveryRow): DeliveringBriefDelivery {
  const delivery = toDelivery(row)

  if (delivery.state !== 'delivering') {
    throw new StorageError(`brief delivery is ${delivery.state} where a claimed row was required`)
  }

  return delivery
}

function toLeaseToken(row: BriefDeliveryRow): LeaseToken {
  // why-safe: the row is in `delivering`, whose CHECK requires a token this store itself minted.
  return readColumn(row.lease_token, row, 'lease_token') as LeaseToken
}

function readColumn<T>(value: T | null, row: BriefDeliveryRow, column: string): T {
  return requireColumn(value, `brief delivery is ${row.state} without ${column}`)
}
