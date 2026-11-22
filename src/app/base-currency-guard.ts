import type { ServiceProvider } from '@/core/container'
import type { UserProfile } from '@/trading/api'
import { OperatorConfigError } from '@/core/config/operator-errors'
import { resolveTradingConfig } from '@/trading/api'

// The persisted profile fixes the book's base currency the first time it is saved
// (portfolio/profile.ts) while `[locale] currency` is live config a later edit can change.
// Unguarded, a mismatch only surfaces as a repeated ValidationError deep inside the ledger fold
// (portfolio/book.ts assertRecordedInBase) on every portfolio read thereafter. Wrapping the two
// store methods that feed the fold, `profile.find` and `ledger.listAll`, turns every one of
// those reads into a single clear config error instead.
export function createBaseCurrencyGuardProvider(): ServiceProvider {
  return {
    name: 'trading-base-currency-guard',
    register(_bind, extend): void {
      extend('tradingStores', (current, app) => {
        const baseCurrency = resolveTradingConfig({
          extensions: app.config.extensions,
          locale: app.config.locale,
        }).baseCurrency
        const findProfile = (signal: AbortSignal): Promise<UserProfile | null> =>
          assertProfileCurrency(current.profile.find(signal), baseCurrency)

        return {
          ...current,
          profile: { ...current.profile, find: findProfile },
          ledger: {
            ...current.ledger,
            listAll: async (signal) => {
              await findProfile(signal)
              return current.ledger.listAll(signal)
            },
          },
        }
      })
    },
  }
}

async function assertProfileCurrency(
  pending: Promise<UserProfile | null>,
  baseCurrency: UserProfile['baseCurrency']
): Promise<UserProfile | null> {
  const profile = await pending

  if (profile && profile.baseCurrency !== baseCurrency) {
    throw new OperatorConfigError(
      `[locale] currency is ${baseCurrency}, but the trading profile was created with ` +
        `${profile.baseCurrency} and never changes; restore [locale] currency to ` +
        `${profile.baseCurrency}`,
      {
        key: 'errors.configCurrencyLocked',
        params: { currency: baseCurrency, profileCurrency: profile.baseCurrency },
      },
      { path: ['locale', 'currency'] }
    )
  }

  return profile
}
