import type { Bind } from '@/core/container'
import type { TradingConfig } from '@/trading/kernel/config'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import { SURFACE_LIMITS } from '@/trading/surface-limits'
import { listSourceHosts } from '@/trading/wiring/composition/source-hosts'
import { createTradingHost } from '@/trading/wiring/host/host'

/** How long one host-mediated request may run before its scope aborts. A ceiling on a surface
 *  call, not an operator preference: a stuck upstream must not hold an HTTP connection open. */
const HOST_REQUEST_TIMEOUT_MS = 30_000
/** The same ceiling for a screen, a rebalance or an overview: each can refresh a cold market first,
 *  which the boot refresh budgets a minute for. */
export const HOST_SLOW_REQUEST_TIMEOUT_MS = 120_000

interface HostSeamOptions {
  readonly tradingConfig: TradingConfig
  readonly pluginModules: readonly LoadedSourceModule[]
}

/** What the server reads of trading: the one surface it calls, and where the sources reach. The host
 *  is bound here because it is derived purely from the aggregate; the operator identity and
 *  shutdown signal come from the container. The source hosts wait on the plugin modules, which only
 *  the registration sees. */
export function bindHostSeams(bind: Bind, options: HostSeamOptions): void {
  bind('tradingHost', (app) =>
    createTradingHost({
      limits: SURFACE_LIMITS,
      services: app.resolve('tradingServices'),
      defaultLocale: app.config.locale.language,
      baseCurrency: options.tradingConfig.baseCurrency,
      shutdownSignal: app.signal,
      requestTimeoutMs: HOST_REQUEST_TIMEOUT_MS,
      slowRequestTimeoutMs: HOST_SLOW_REQUEST_TIMEOUT_MS,
    })
  )
  bind('sourceHosts', () => listSourceHosts(options.pluginModules))
}
