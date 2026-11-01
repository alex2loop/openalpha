import type { ResolvedConfig } from '@/core/config/resolve'
import type { ConfigCheck } from '@/core/config/validate'
import type { SocialConfig } from '@/social/api'
import type { TradingConfig } from '@/trading/api'
import { assertNoticeChatKinds } from '@/app/notice-sender'
import { assertChannelConfigs } from '@/channels/api'
import { assertExtensionsClaimed } from '@/core/config/resolve'
import { validateConfigTree } from '@/core/config/validate'
import { resolveSocialConfig, SOCIAL_CONFIG_SECTION } from '@/social/api'
import { resolveTradingConfig, TRADING_CONFIG_SECTION } from '@/trading/api'

// Top-level sections core does not know, each named by the module that parses it.
const CLAIMED_CONFIG_SECTIONS: readonly string[] = Object.freeze([
  TRADING_CONFIG_SECTION,
  SOCIAL_CONFIG_SECTION,
])

interface BootExtensions {
  readonly trading: TradingConfig
  readonly social: SocialConfig
}

/** Boot's checks past core's resolve, in order; shared by the daemon and the config editor. */
export function resolveBootExtensions(config: ResolvedConfig): BootExtensions {
  // Run first: a whole section nobody owns is a worse problem than a typo in one that is read.
  assertExtensionsClaimed(config.extensions, CLAIMED_CONFIG_SECTIONS)
  assertChannelConfigs(config.channels)
  assertNoticeChatKinds(config.notices.chat)

  return resolveClaimedSections(config)
}

/** Every refusal `resolveBootExtensions` could raise, each checked on its own, so `config validate`
 *  names an unknown section and a typo inside `[trading]` in the same run. */
export function bootRefusals(config: ResolvedConfig): readonly unknown[] {
  return [
    refusalOf(() => assertExtensionsClaimed(config.extensions, CLAIMED_CONFIG_SECTIONS)),
    refusalOf(() => assertChannelConfigs(config.channels)),
    refusalOf(() => assertNoticeChatKinds(config.notices.chat)),
    refusalOf(() => resolveClaimedSections(config)),
  ].filter((refusal) => refusal !== undefined)
}

export function validateBootConfigTree(tree: unknown): ConfigCheck {
  return validateConfigTree(tree, resolveBootExtensions)
}

function resolveClaimedSections(config: ResolvedConfig): BootExtensions {
  return {
    trading: resolveTradingConfig({ extensions: config.extensions, locale: config.locale }),
    social: resolveSocialConfig({
      extensions: config.extensions,
      loopMaxDurationMs: config.loop.maxDurationMs,
      timeZone: config.locale.timezone,
    }),
  }
}

function refusalOf(check: () => unknown): unknown {
  try {
    check()

    return undefined
  } catch (err: unknown) {
    return err
  }
}
