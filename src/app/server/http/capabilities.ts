import type { Capabilities } from '@/app/server/wire/system'
import type { App } from '@/core/container'

// Which optional sections the client may render. Read off the composed route table rather than
// declared twice: a capability is true exactly when its route is present, so a route removed from
// the table can never leave a flag claiming the section still works.
export function buildCapabilities(app: App): Capabilities {
  const routes = app.resolve('apiRoutes')
  const has = (path: string): boolean => routes.some((route) => route.path === path)

  return {
    ohlcv: has('/v1/ohlcv'),
    quotes: has('/v1/quotes'),
    portfolio: has('/v1/portfolio'),
    suggestions: has('/v1/suggestions'),
    orders: has('/v1/trade') && app.resolve('tradingHost').ordersEnabled(),
  }
}
