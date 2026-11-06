import type { BrowserKeyring } from '@/app/browser/keys'
import type { SystemHost } from '@/app/server/routes/system'
import type { FeatureCapabilities } from '@/app/server/wire/system'
import type { Authorize } from '@/app/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import { aiKeyVariable, hasAiKey, readModelProvider } from '@/app/browser/keys'

/** What this edition offers, fixed: a web page analyses and keeps a ledger, and has no venue, no
 *  channel, no scheduler, no agent and no ChatGPT sign-in. */
const BROWSER_FEATURES: FeatureCapabilities = Object.freeze({
  analysisOnly: true,
  venues: false,
  channels: false,
  schedules: false,
  agents: false,
  chatgpt: false,
})

/** One caller: the visitor at this page. Nothing reaches the worker but the page that started it,
 *  so there is no token, session or origin to judge. */
export const authorizeVisitor: Authorize = async () => ({ credential: 'valid' })

/** What the status routes ask of the process serving them. A worker has no pid to report and cannot
 *  restart itself (the page replaces it), and what it started without is the keys, which the page
 *  asks about through `modelReady`. */
export function createBrowserSystemHost(
  keyring: BrowserKeyring,
  config: ResolvedConfig
): SystemHost {
  // The key a run needs is the main model's, not any key the visitor happens to hold.
  const provider = readModelProvider(config)

  return {
    health: () => ({ running: true }),
    restart: () => ({ restartable: false, restartIdleWaitMs: 0, restartDrainMs: 0 }),
    degraded: async () => [],
    modelReady: async () =>
      hasAiKey(keyring.env(), provider)
        ? { modelReady: true }
        : { modelReady: false, modelKeyEnv: aiKeyVariable(provider) },
    features: () => BROWSER_FEATURES,
  }
}
