import type { App, TaskPassListener } from '@/core/container'
import type { RequestShape } from '@/core/http-client'
import type { ReachabilityProbe } from '@/core/limits'
import type { ScheduledRunner } from '@/core/types/command'
import type { RoleOutputListener } from '@/trading/features/suggestion/debate/types'
import type { CallScoredNotices } from '@/trading/features/suggestion/track-record/scored-notice'
import type { TradingConfig } from '@/trading/kernel/config'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type {
  AlertFiredListener,
  OrderFilledListener,
  TradingNoticeSender,
} from '@/trading/kernel/operator/notice'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import type { SourceRouteTable } from '@/trading/sources/routes'
import type { TradingEdition } from '@/trading/wiring/composition/edition'
import type { KeyValidator } from '@/trading/wiring/composition/registry-checks'

/** Only what the container cannot supply. Everything else — the logger, the runner, the locale,
 *  the budget policy — is resolved from `App` inside the lazy factory, so nothing here duplicates
 *  a value the container already owns. */
export interface TradingRegistrationOptions {
  readonly tradingConfig: TradingConfig
  /** Injected, never read from `process`: source credentials resolve from named variables the
   *  code owns, so the value reaches the transport without passing through a config object. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Built where it binds, with the app in hand: the sender reads services the container supplies. */
  sender(app: App): TradingNoticeSender
  /** Bound with the app in hand, like the sender: showing a fill needs the bus. */
  onFilled(app: App): OrderFilledListener
  /** Bound with the app in hand: starting a job that waits on an alert needs the scheduler. */
  onAlertFired(app: App): AlertFiredListener
  /** Bound with the app in hand: telling the page an alert pass finished needs the bus. */
  onAlertsChecked(app: App): (at: number) => void
  /** Bound with the app in hand: the page shows each loop's last and next pass. */
  onTaskPass(app: App): TaskPassListener
  /** Bound with the app in hand: the page shows a scheduled refresh as the `/refresh` run. */
  runScheduled(app: App): ScheduledRunner
  /** Bound with the app in hand: the page shows what each debate role said. */
  onRoleOutput(app: App): RoleOutputListener
  /** Bound with the app in hand: the page shows an own agent's call being scored. */
  onFocusCallScored(app: App): CallScoredNotices['onFocusScored']
  /** Where an unaddressed notice goes. A thunk because channels attach and detach while the daemon
   *  runs, and `app` owns the hub that answers - trading never imports a scheduler type. */
  recipient(): DeliveryAddress | undefined
  readonly keys: KeyValidator
  readonly pluginModules: readonly LoadedSourceModule[]
  /** How every source request presents itself: the daemon's or a page's. */
  readonly requestShape: RequestShape
  readonly routes?: SourceRouteTable
  /** The providers that must send a plain user agent; absent is the daemon's list. A page cannot
   *  set the header, so it passes none. */
  readonly plainUserAgentSources?: ReadonlySet<SourceId>
  /** The news feeds that may be fetched; absent is every feed. */
  readonly feeds?: Readonly<Record<string, string>>
  /** What this edition narrows, bound with the app in hand like the sender; absent is the
   *  installed version. */
  edition?(app: App): TradingEdition
  /** How the loops tell the network is up: the daemon resolves a name. */
  readonly reachability: ReachabilityProbe
}

/** The options once the sender and the fill listener are built: everything below the provider
 *  reads them themselves. */
export type BoundOptions = Omit<
  TradingRegistrationOptions,
  | 'sender'
  | 'onFilled'
  | 'onAlertFired'
  | 'onAlertsChecked'
  | 'onTaskPass'
  | 'runScheduled'
  | 'onRoleOutput'
  | 'onFocusCallScored'
  | 'edition'
> & {
  readonly sender: TradingNoticeSender
  readonly onFilled: OrderFilledListener
  readonly onAlertFired: AlertFiredListener
  readonly onAlertsChecked: (at: number) => void
  readonly onTaskPass: TaskPassListener
  readonly runScheduled: ScheduledRunner
  readonly onRoleOutput: RoleOutputListener
  readonly onFocusCallScored: CallScoredNotices['onFocusScored']
  readonly edition?: TradingEdition
  readonly lateGraceMs: number
}

export function bindOptions(app: App, provided: TradingRegistrationOptions): BoundOptions {
  const { edition, ...rest } = provided

  return {
    ...rest,
    sender: provided.sender(app),
    onFilled: provided.onFilled(app),
    onAlertFired: provided.onAlertFired(app),
    onAlertsChecked: provided.onAlertsChecked(app),
    onTaskPass: provided.onTaskPass(app),
    runScheduled: provided.runScheduled(app),
    onRoleOutput: provided.onRoleOutput(app),
    onFocusCallScored: provided.onFocusCallScored(app),
    ...(edition === undefined ? {} : { edition: edition(app) }),
    lateGraceMs: app.config.schedule.lateGraceMs,
  }
}
