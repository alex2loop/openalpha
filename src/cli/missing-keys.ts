import type { DegradedItem } from '@/core/container'
import { missingKeyErrors } from '@/ai/api'
import {
  type MissingEnvError,
  type ResolvedConfig,
  toMissingSearchKeyError,
} from '@/core/config/resolve'
import { missingCredentials } from '@/core/security/credentials'
import { resolveTradingConfig, unavailableSources } from '@/trading/api'

/** Every unset key variable the resolved config names, one per variable: the model chain and its
 *  tiers, web search and MCP servers. Each only takes its own feature down. */
export function toMissingKeyErrors(config: ResolvedConfig): readonly MissingEnvError[] {
  const search = toMissingSearchKeyError(config.webSearch)

  return [
    ...missingKeyErrors(config),
    ...(search === undefined ? [] : [search]),
    ...config.mcp.unset,
  ]
}

/** Every key the environment leaves unset and what waits for it: the errors above, the exchanges
 *  that cannot place orders, and the optional sources a keyless provider covers. The one list
 *  `start` prints and `status` and `/v1/health` read back from the running daemon. */
export function toKeylessItems(
  config: ResolvedConfig,
  env: Readonly<Record<string, string | undefined>>
): readonly DegradedItem[] {
  const trading = resolveTradingConfig({ extensions: config.extensions, locale: config.locale })

  return [
    ...toMissingKeyErrors(config).map(
      (err): DegradedItem => ({ kind: 'key', subject: err.env, message: err.operator })
    ),
    ...toKeylessVenues(trading.venues, env),
    ...unavailableSources({ env, credentialEnv: trading.sourceCredentialEnv }).map(
      ({ source, variable, adds }): DegradedItem => ({
        kind: 'optional-key',
        subject: variable,
        message: {
          key: 'cli.doctorSourceOptional',
          params: { source, variable, adds: { key: adds } },
        },
      })
    ),
  ]
}

// The predicate `buildVenues` leaves on each manifest as `missingCredentials`, read from the same
// names: a broker traded by hand names none, so it never appears. Optional, since recording trades by
// hand is the keyless path; `/trade` and `/record sync` name the variables when asked.
function toKeylessVenues(
  venues: ReturnType<typeof resolveTradingConfig>['venues'],
  env: Readonly<Record<string, string | undefined>>
): readonly DegradedItem[] {
  return Object.entries(venues).flatMap(([venue, config]): DegradedItem[] => {
    const variables = missingCredentials(env, config?.credentialEnv)

    if (variables.length === 0) {
      return []
    }

    return [
      {
        kind: 'optional-key',
        subject: venue,
        message: {
          key: 'cli.keylessVenue',
          params: { venue: { key: `trading.venue.${venue}` }, variables: variables.join(', ') },
        },
      },
    ]
  })
}

/** Every variable the config reads a key from, set or not: the model chain and its tiers, web
 *  search, MCP placeholders, channel tokens, venue credentials and source keys. */
export function keyEnvNames(config: ResolvedConfig): readonly string[] {
  const trading = resolveTradingConfig({ extensions: config.extensions, locale: config.locale })
  const models = [...config.models, ...Object.values(config.modelTiers).flat()]
  const names = [
    ...models.map((model) => model.apiKeyEnv),
    config.webSearch.apiKeyEnv,
    config.webSearch.fallbackApiKeyEnv,
    ...config.mcp.envNames,
    ...Object.values(config.channels).map(channelTokenEnv),
    ...Object.values(trading.venues).flatMap((venue) => Object.values(venue?.credentialEnv ?? {})),
    ...Object.values(trading.sourceCredentialEnv),
  ]

  return [...new Set(names.filter((name): name is string => name !== undefined))].sort()
}

function channelTokenEnv(channel: unknown): string | undefined {
  if (typeof channel !== 'object' || channel === null || !('token_env' in channel)) {
    return undefined
  }

  return typeof channel.token_env === 'string' ? channel.token_env : undefined
}
