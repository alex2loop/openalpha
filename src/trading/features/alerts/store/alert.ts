import type { AlertRow } from '@/trading/features/alerts/store/alert-row'
import type {
  ActiveAlert,
  Alert,
  AlertOrigin,
  DeliveringAlert,
  DisableAlertResult,
  FiredAlert,
  LeaseToken,
} from '@/trading/features/alerts/types'
import type { DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type { Page, PageOptions } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, ValidationError } from '@/core/errors'
import {
  countActiveAlerts,
  listAlertIdsMatching,
} from '@/trading/features/alerts/store/alert-lookup'
import {
  toActiveAlert,
  toAlert,
  toDeliveringAlert,
  toFiredAlert,
} from '@/trading/features/alerts/store/alert-row'
import { alertOrigin } from '@/trading/features/alerts/types'
import { claimDueRows } from '@/trading/features/suggestion/store/claim'
import { toPage } from '@/trading/kernel/store/store-row'

const INSERT_SQL =
  'INSERT INTO alerts (id, market, ticker, condition, threshold, channel, ' +
  'chat_id, state, created_at, attempts, origin) VALUES '
export const DUE_STATES = Object.freeze(['triggered', 'delivering'] as const)
const LIVE_STATES_SQL = "('active','triggered','delivering')"

type AlertCreateResult =
  | { readonly kind: 'inserted'; readonly alert: Alert }
  | { readonly kind: 'existing'; readonly alert: Alert }

interface FindAlertOptions {
  readonly alertId: AlertId
  readonly signal: AbortSignal
}

interface ListLiveWithOriginOptions {
  readonly cursor?: AlertId
  readonly limit: number
  readonly signal: AbortSignal
}

interface ListFiredOptions {
  readonly firedAfter?: number
  readonly limit: number
  readonly signal: AbortSignal
}

interface MarkTriggeredOptions {
  readonly alertId: AlertId
  readonly triggeredAt: number
  readonly observedPrice: number
  readonly nextDueAt: number
  readonly signal: AbortSignal
}

interface ClaimAlertsOptions {
  readonly now: number
  readonly leaseToken: LeaseToken
  readonly leaseUntil: number
  readonly limit: number
  readonly signal: AbortSignal
}

interface MarkFiredOptions {
  readonly alertId: AlertId
  readonly leaseToken: LeaseToken
  readonly firedAt: number
  readonly signal: AbortSignal
}

interface DeferAlertOptions {
  readonly alertId: AlertId
  readonly leaseToken: LeaseToken
  readonly nextDueAt: number
  readonly errorCode: DeliveryErrorCode
  readonly signal: AbortSignal
}

interface ListKnownOriginsOptions {
  readonly origins: readonly AlertOrigin[]
  readonly rearmBefore: number
  readonly signal: AbortSignal
}

interface DisableAlertOptions {
  readonly alertId: AlertId
  readonly disabledAt: number
  /** Set only when delivery gave up: the row keeps the code that marks it as exhausted rather than
   *  retired by an operator or a reconcile pass, which is what lets its origin be armed again. */
  readonly errorCode?: DeliveryErrorCode
  readonly signal: AbortSignal
}

interface ReleaseAlertOptions {
  readonly alertId: AlertId
  readonly leaseToken: LeaseToken
  readonly now: number
}

export interface AlertStore {
  create(alert: ActiveAlert, signal: AbortSignal): Promise<AlertCreateResult>
  find(options: FindAlertOptions): Promise<Alert | null>
  /** The alerts a full id or a short tail of one could name. */
  listIdsMatching(ref: string, signal: AbortSignal): Promise<readonly AlertId[]>
  listPage(options: PageOptions<AlertId>): Promise<Page<Alert, AlertId>>
  listActive(options: PageOptions<AlertId>): Promise<Page<ActiveAlert, AlertId>>
  countActive(signal: AbortSignal): Promise<number>
  listFired(options: ListFiredOptions): Promise<readonly FiredAlert[]>
  /** The live system-armed rows, for the arming passes that reconcile them against the book. Paged
   *  by id ascending — a reconcile pass walks every page, never just the first, or rows past the
   *  batch size are silently skipped every tick. */
  listLiveWithOrigin(options: ListLiveWithOriginOptions): Promise<Page<Alert, AlertId>>
  findLiveByOrigin(origin: AlertOrigin, signal: AbortSignal): Promise<Alert | null>
  /** Which of the given origins already have a row, in any state. A fired or disabled row falls
   *  outside `listLiveWithOrigin`'s live index but must still block a re-arm: the identity already
   *  ran its course, and only a genuinely new origin (a new suggestion, a new settled day) is
   *  eligible to arm again. The one exception is a row disabled because delivery gave up before
   *  `rearmBefore`: it never reached the operator, so its origin is eligible again. */
  listKnownOrigins(options: ListKnownOriginsOptions): Promise<ReadonlySet<AlertOrigin>>
  markTriggered(options: MarkTriggeredOptions): Promise<boolean>
  claimDue(options: ClaimAlertsOptions): Promise<readonly DeliveringAlert[]>
  markFired(options: MarkFiredOptions): Promise<boolean>
  deferDelivery(options: DeferAlertOptions): Promise<boolean>
  disable(options: DisableAlertOptions): Promise<DisableAlertResult>
  /** Undoes a claim whose delivery was aborted before it completed: back to `triggered`, due
   *  immediately, with the claim's attempt increment handed back. Takes no signal — this is the
   *  cleanup that runs while the tick's signal is already aborted. */
  release(options: ReleaseAlertOptions): Promise<boolean>
}

export function createAlertStore(deps: StoreDeps): AlertStore {
  return {
    create: (alert, signal) => create(deps, alert, signal),
    find: (options) => find(deps, options),
    listIdsMatching: (ref, signal) => listAlertIdsMatching(deps, ref, signal),
    listPage: (options) => listPage(deps, options),
    listActive: (options) => listActive(deps, options),
    countActive: (signal) => countActiveAlerts(deps, signal),
    listFired: (options) => listFired(deps, options),
    listLiveWithOrigin: (options) => listLiveWithOrigin(deps, options),
    findLiveByOrigin: (origin, signal) => findLiveByOrigin(deps, origin, signal),
    listKnownOrigins: (options) => listKnownOrigins(deps, options),
    markTriggered: (options) => markTriggered(deps, options),
    claimDue: (options) => claimDue(deps, options),
    markFired: (options) => markFired(deps, options),
    deferDelivery: (options) => deferDelivery(deps, options),
    disable: (options) => disable(deps, options),
    release: (options) => release(deps, options),
  }
}

/** The unique partial index decides; the store never pre-checks. A `SELECT` then `INSERT` is a
 *  race, and under it two identical alerts both get created. A matching row sitting in `fired` or
 *  `disabled` is outside that index, so the insert would otherwise succeed and re-arm a retired
 *  identity — every reconcile pass is required to gate on `listKnownOrigins` before calling
 *  `create` with a system origin, so that row is never reached here in practice. */
async function create(
  deps: StoreDeps,
  alert: ActiveAlert,
  signal: AbortSignal
): Promise<AlertCreateResult> {
  assertNotAborted(signal)

  const inserted = await deps.db.execute(
    `${INSERT_SQL}(${deps.dialect.paramList(11)}) ON CONFLICT DO NOTHING`,
    [
      alert.id,
      alert.instrument.market,
      alert.instrument.ticker,
      alert.condition,
      alert.threshold,
      alert.delivery.channel,
      alert.delivery.chatId,
      alert.state,
      alert.createdAt,
      0,
      alert.origin ?? null,
    ]
  )

  if (inserted.changes === 1) {
    return { kind: 'inserted', alert }
  }

  const existing =
    alert.origin === undefined
      ? await findLive(deps, alert)
      : await findLiveByOrigin(deps, alert.origin, signal)

  if (!existing) {
    throw new ValidationError('alert insert conflicted with no live row')
  }

  return { kind: 'existing', alert: existing }
}

async function findLive(deps: StoreDeps, alert: ActiveAlert): Promise<Alert | null> {
  const p = deps.dialect.param
  const rows = await deps.db.query<AlertRow>(
    `SELECT * FROM alerts WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND condition = ${p(3)} AND threshold = ${p(4)} AND channel = ${p(5)} AND chat_id = ${p(6)} ` +
      `AND state IN ${LIVE_STATES_SQL}`,
    [
      alert.instrument.market,
      alert.instrument.ticker,
      alert.condition,
      alert.threshold,
      alert.delivery.channel,
      alert.delivery.chatId,
    ]
  )
  const row = rows[0]

  return row ? toAlert(row) : null
}

async function findLiveByOrigin(
  deps: StoreDeps,
  origin: AlertOrigin,
  signal: AbortSignal
): Promise<Alert | null> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<AlertRow>(
    `SELECT * FROM alerts WHERE origin = ${p(1)} AND state IN ${LIVE_STATES_SQL}`,
    [origin]
  )
  const row = rows[0]

  return row ? toAlert(row) : null
}

/** Ascending by id so an early alert that never leaves the filter cannot starve later ids across
 *  passes. Callers bring the base predicate; the cursor clause and the bound are the same for all
 *  of them. */
async function pageAlertsById<T extends { readonly id: AlertId }>(
  deps: StoreDeps,
  options: PageOptions<AlertId> & { readonly where: string },
  toItem: (row: AlertRow) => T
): Promise<Page<T, AlertId>> {
  const p = deps.dialect.param
  const params: unknown[] = []
  let where = options.where

  if (options.cursor) {
    params.push(options.cursor)
    where += ` AND id > ${p(params.length)}`
  }

  params.push(options.limit + 1)

  const rows = await deps.db.query<AlertRow>(
    `SELECT * FROM alerts WHERE ${where} ORDER BY id LIMIT ${p(params.length)}`,
    params
  )

  return toPage(rows.map(toItem), options.limit, (item) => item.id)
}

async function listLiveWithOrigin(
  deps: StoreDeps,
  options: ListLiveWithOriginOptions
): Promise<Page<Alert, AlertId>> {
  assertNotAborted(options.signal)

  const where = `origin IS NOT NULL AND state IN ${LIVE_STATES_SQL}`

  return pageAlertsById(deps, { ...options, where }, toAlert)
}

/** A targeted `IN` lookup, not a table scan: the candidate list is the small set a reconcile pass
 *  just computed as expected, never the whole history. */
async function listKnownOrigins(
  deps: StoreDeps,
  options: ListKnownOriginsOptions
): Promise<ReadonlySet<AlertOrigin>> {
  const { origins } = options

  assertNotAborted(options.signal)

  if (origins.length === 0) {
    return new Set()
  }

  const rows = await deps.db.query<{ readonly origin: string }>(
    `SELECT DISTINCT origin FROM alerts WHERE origin IN (${deps.dialect.paramList(origins.length)}) ` +
      "AND NOT (state = 'disabled' AND last_error_code IS NOT NULL " +
      `AND disabled_at <= ${deps.dialect.param(origins.length + 1)})`,
    [...origins, options.rearmBefore]
  )

  return new Set(rows.map((row) => alertOrigin(row.origin)))
}

async function find(deps: StoreDeps, options: FindAlertOptions): Promise<Alert | null> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<AlertRow>(
    `SELECT * FROM alerts WHERE id = ${deps.dialect.param(1)}`,
    [options.alertId]
  )
  const row = rows[0]

  return row ? toAlert(row) : null
}

async function listPage(
  deps: StoreDeps,
  options: PageOptions<AlertId>
): Promise<Page<Alert, AlertId>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  let where = ''

  if (options.cursor) {
    params.push(options.cursor)
    where = `WHERE id < ${p(params.length)} `
  }

  params.push(options.limit + 1)

  const rows = await deps.db.query<AlertRow>(
    `SELECT * FROM alerts ${where}ORDER BY id DESC LIMIT ${p(params.length)}`,
    params
  )

  return toPage(rows.map(toAlert), options.limit, (alert) => alert.id)
}

async function listActive(
  deps: StoreDeps,
  options: PageOptions<AlertId>
): Promise<Page<ActiveAlert, AlertId>> {
  assertNotAborted(options.signal)

  return pageAlertsById(deps, { ...options, where: "state = 'active'" }, toActiveAlert)
}

async function listFired(
  deps: StoreDeps,
  options: ListFiredOptions
): Promise<readonly FiredAlert[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  let where = "state = 'fired'"

  if (options.firedAfter !== undefined) {
    params.push(options.firedAfter)
    where += ` AND fired_at > ${p(params.length)}`
  }

  params.push(options.limit)

  const rows = await deps.db.query<AlertRow>(
    `SELECT * FROM alerts WHERE ${where} ORDER BY fired_at DESC LIMIT ${p(params.length)}`,
    params
  )

  return rows.map(toFiredAlert)
}

async function markTriggered(deps: StoreDeps, options: MarkTriggeredOptions): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE alerts SET state = 'triggered', triggered_at = ${p(1)}, observed_price = ${p(2)}, ` +
      `next_due_at = ${p(3)} WHERE id = ${p(4)} AND state = 'active'`,
    [options.triggeredAt, options.observedPrice, options.nextDueAt, options.alertId]
  )

  return result.changes === 1
}

async function claimDue(
  deps: StoreDeps,
  options: ClaimAlertsOptions
): Promise<readonly DeliveringAlert[]> {
  const rows = await claimDueRows<AlertRow>(deps, {
    table: 'alerts',
    dueStates: DUE_STATES,
    claimState: 'delivering',
    now: options.now,
    leaseToken: options.leaseToken,
    leaseUntil: options.leaseUntil,
    limit: options.limit,
    signal: options.signal,
  })

  return rows.map(toDeliveringAlert)
}

/** Every post-claim transition carries `AND lease_token = ?`: a stale worker whose lease expired
 *  and was re-claimed writes nothing and gets `false`, so it cannot overwrite the newer claim. */
async function markFired(deps: StoreDeps, options: MarkFiredOptions): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE alerts SET state = 'fired', fired_at = ${p(1)}, lease_token = NULL, ` +
      `lease_until = NULL ` +
      `WHERE id = ${p(2)} AND state = 'delivering' AND lease_token = ${p(3)}`,
    [options.firedAt, options.alertId, options.leaseToken]
  )

  return result.changes === 1
}

/** The claim already incremented `attempts`; deferring must not count the same try twice. */
async function deferDelivery(deps: StoreDeps, options: DeferAlertOptions): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE alerts SET state = 'triggered', next_due_at = ${p(1)}, last_error_code = ${p(2)}, ` +
      `lease_token = NULL, lease_until = NULL ` +
      `WHERE id = ${p(3)} AND state = 'delivering' AND lease_token = ${p(4)}`,
    [options.nextDueAt, options.errorCode, options.alertId, options.leaseToken]
  )

  return result.changes === 1
}

async function release(deps: StoreDeps, options: ReleaseAlertOptions): Promise<boolean> {
  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE alerts SET state = 'triggered', next_due_at = ${p(1)}, attempts = attempts - 1, ` +
      'lease_token = NULL, lease_until = NULL ' +
      `WHERE id = ${p(2)} AND state = 'delivering' AND lease_token = ${p(3)}`,
    [options.now, options.alertId, options.leaseToken]
  )

  return result.changes === 1
}

/** One CAS transition, never a delete: the closed result tells a repeated disable from a missing
 *  id and from an alert that already fired, so no caller guesses from a boolean. */
async function disable(deps: StoreDeps, options: DisableAlertOptions): Promise<DisableAlertResult> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE alerts SET state = 'disabled', disabled_at = ${p(1)}, last_error_code = ${p(2)}, ` +
      `lease_token = NULL, lease_until = NULL, next_due_at = NULL ` +
      `WHERE id = ${p(3)} AND state IN ('active','triggered','delivering')`,
    [options.disabledAt, options.errorCode ?? null, options.alertId]
  )

  if (result.changes === 1) {
    return 'disabled'
  }

  const existing = await find(deps, { alertId: options.alertId, signal: options.signal })

  if (!existing) {
    return 'not-found'
  }

  return existing.state === 'fired' ? 'already-fired' : 'already-disabled'
}
