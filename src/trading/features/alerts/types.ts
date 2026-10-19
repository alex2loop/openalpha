import { randomUUID } from 'node:crypto'

import type { BrandTag } from '@/core/ids'
import type { Caveat, DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { InstrumentRef, TickerRequest } from '@/trading/kernel/instrument'
import type { AlertCondition, AlertId, StopDistance } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { OperationTickOptions, Page, PageOptions } from '@/trading/kernel/store/page'
import type { TypedPrice } from '@/trading/kernel/surface/surface'

export type LeaseToken = string & BrandTag<'LeaseToken'>

export type AlertOrigin = string & BrandTag<'AlertOrigin'>

export const EXIT_LEVELS = Object.freeze(['stop', 'target'] as const)
type ExitLevel = (typeof EXIT_LEVELS)[number]

const SCREEN_DIRECTIONS = Object.freeze(['up', 'down'] as const)
type ScreenDirection = (typeof SCREEN_DIRECTIONS)[number]

const EXIT_ORIGIN_PREFIX = 'exit'
const SCREEN_ORIGIN_PREFIX = 'screen'

export const ALERT_STATES = Object.freeze([
  'active',
  'triggered',
  'delivering',
  'fired',
  'disabled',
] as const)
export type AlertState = (typeof ALERT_STATES)[number]

export const DISABLE_ALERT_RESULTS = Object.freeze([
  'disabled',
  'already-disabled',
  'already-fired',
  'not-found',
] as const)
export type DisableAlertResult = (typeof DISABLE_ALERT_RESULTS)[number]

interface AlertBase {
  readonly id: AlertId
  readonly instrument: InstrumentRef
  readonly condition: AlertCondition
  readonly threshold: number
  readonly delivery: DeliveryAddress
  /** Set only on system-armed rows; the deterministic identity the arming pass upserts against.
   *  Absent means the operator armed it. */
  readonly origin?: AlertOrigin
  readonly createdAt: number
}

export type Alert =
  | (AlertBase & { readonly state: 'active' })
  | (AlertBase & {
      readonly state: 'triggered'
      readonly triggeredAt: number
      readonly observedPrice: number
      readonly nextAttemptAt: number
      readonly attempts: number
      readonly lastErrorCode?: DeliveryErrorCode
    })
  | (AlertBase & {
      readonly state: 'delivering'
      readonly triggeredAt: number
      readonly observedPrice: number
      readonly attempts: number
      readonly leaseToken: LeaseToken
      readonly leaseUntil: number
    })
  | (AlertBase & {
      readonly state: 'fired'
      readonly triggeredAt: number
      readonly observedPrice: number
      readonly firedAt: number
    })
  | (AlertBase & { readonly state: 'disabled'; readonly disabledAt: number })

export type ActiveAlert = Extract<Alert, { readonly state: 'active' }>
export type DeliveringAlert = Extract<Alert, { readonly state: 'delivering' }>
export type FiredAlert = Extract<Alert, { readonly state: 'fired' }>

export function buildLeaseToken(): LeaseToken {
  // why-safe: a freshly minted UUID is the token brand's entire value space.
  return randomUUID() as LeaseToken
}

export function alertOrigin(raw: string): AlertOrigin {
  // why-safe: the brand only asserts provenance from an arming pass or a stored row; both wrote
  // the value through buildExitOrigin.
  return raw as AlertOrigin
}

/** The threshold is part of the identity: a stop the trail has raised is a different origin, so the
 *  new one arms while the old retires through `disableStale` rather than being amended in place. */
export function buildExitOrigin(
  suggestionId: string,
  level: ExitLevel,
  threshold: number
): AlertOrigin {
  return alertOrigin(`${EXIT_ORIGIN_PREFIX}:${suggestionId}:${level}:${threshold}`)
}

export function buildScreenOrigin(
  instrument: InstrumentRef,
  direction: ScreenDirection,
  day: string
): AlertOrigin {
  return alertOrigin(
    `${SCREEN_ORIGIN_PREFIX}:${instrument.market}:${instrument.ticker}:${direction}:${day}`
  )
}

export function isScreenOrigin(origin: AlertOrigin | undefined): origin is AlertOrigin {
  return origin?.startsWith(`${SCREEN_ORIGIN_PREFIX}:`) === true
}

/** The level an exit origin armed, or null for an operator-armed or foreign origin. */
export function parseExitLevel(origin: AlertOrigin | undefined): ExitLevel | null {
  if (origin === undefined || !origin.startsWith(`${EXIT_ORIGIN_PREFIX}:`)) {
    return null
  }

  const level = origin.split(':')[2]

  return EXIT_LEVELS.find((candidate) => candidate === level) ?? null
}

export interface AlertListPage extends Page<Alert, AlertId> {
  readonly activeCount: number
}

export interface AlertService {
  create(options: CreateAlertOptions): Promise<Alert>
  /** Where an alert armed from this address would be delivered, or undefined when nowhere. The
   *  operator-facing arming paths ask it; `create` asks it itself for an operator-armed alert, and
   *  the system arming passes reuse an address a stored row already carries. */
  resolveRecipient(origin: DeliveryAddress): Promise<DeliveryAddress | undefined>
  list(options: PageOptions<AlertId>): Promise<Page<Alert, AlertId>>
  /** A page plus how many alerts are active in all, for a surface that shows the total. */
  listWithActiveCount(options: PageOptions<AlertId>): Promise<AlertListPage>
  listFired(options: {
    readonly firedAfter?: number
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly FiredAlert[]>
  disable(options: DisableAlertOptions): Promise<DisableAlertResult>
  /** The alert a short id names. More than one is ambiguous and the caller asks for more characters;
   *  a ref that cannot be an id names none and never reaches the store. */
  resolveAlertRef(ref: string, signal: AbortSignal): Promise<AlertRefResolution>
  poll(options: OperationTickOptions<AlertId>): Promise<AlertDeliveryBatch>
  /** One daemon sweep over every active alert. The scan position lives in the service: a pool
   *  past one tick's page ceiling resumes where the last tick stopped, since alerts that never
   *  cross never leave the pool and a cursor-less sweep would starve those behind the front. */
  tick(options: OperationTickOptions): Promise<void>
  /** One reconcile pass over the exit levels the book expects, and one over the screener bands.
   *  Both arm and disable through this same service, so crossing, retry and lease keep one owner. */
  tickExits(options: OperationTickOptions): Promise<void>
  tickScreeners(options: OperationTickOptions): Promise<void>
  /** The exit prompt a suggest-only system owes, read on demand rather than armed. */
  positionExits(options: PositionExitOptions): Promise<readonly PositionExit[]>
  unwatchedPositions(options: PositionExitOptions): Promise<readonly InstrumentRef[]>
  /** Held names the window has passed on with nothing decided — the prompt for a fresh read. */
  stalePositions(options: StalePositionOptions): Promise<readonly InstrumentRef[]>
  stopDistances(options: StopDistanceOptions): Promise<readonly StopDistance[]>
}

export interface PositionExitOptions {
  readonly now: number
  readonly signal: AbortSignal
}

/** Marks the caller already holds, keyed by `buildInstrumentKey` and quoted in the market's own
 *  currency — the same currency a stored plan's stop is in, so the two are comparable. Absent for a
 *  caller that has not valued the book, and per instrument for one whose valuation could not price
 *  a holding; either way the market is asked instead. */
export interface StopDistanceOptions extends PositionExitOptions {
  readonly marks?: ReadonlyMap<string, number>
}

/** The stale read needs the operator's segment horizons, because the window a holding is judged
 *  against is the one its own segment is scored over. On this shape rather than on
 *  `StopDistanceOptions`, since the stop-distance read beside it asks a question no horizon enters
 *  and would carry a required field it never looks at. */
export interface StalePositionOptions extends StopDistanceOptions {
  readonly profile: UserProfile
}

export interface PositionExit {
  readonly instrument: InstrumentRef
  /** The side the price crossed its level from, in the alert-condition vocabulary. Which level that
   *  is follows the action: a buy stops out below and targets above, a reduce the other way. */
  readonly condition: AlertCondition
  readonly threshold: number
  readonly observedPrice: number
}

export interface AlertDraft {
  /** The name as the arming surface holds it. `create` resolves it and stores the qualified ref, so
   *  an operator surface may leave the market off exactly where a bare ticker is unambiguous. */
  readonly instrument: TickerRequest
  readonly condition: AlertCondition
  readonly threshold: number
  readonly delivery: DeliveryAddress
  readonly origin?: AlertOrigin
}

export interface CreateAlertOptions {
  readonly draft: AlertDraft
  /** Read for an operator-armed alert only; a system-armed threshold is computed. */
  readonly typedPrice?: TypedPrice
  readonly now: number
  readonly signal: AbortSignal
}

export type AlertRefResolution =
  | { readonly kind: 'one'; readonly id: AlertId }
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly ids: readonly AlertId[] }

export interface DisableAlertOptions {
  readonly alertId: AlertId
  readonly now: number
  readonly signal: AbortSignal
}

export interface AlertDeliveryBatch {
  readonly triggered: number
  readonly delivered: number
  readonly deferred: number
  readonly nextCursor?: AlertId
  readonly caveats: readonly Caveat[]
}
