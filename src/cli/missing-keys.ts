import type { DegradedItem } from '@/core/container'
import { missingKeyErrors } from '@/ai/api'
import { BRAND } from '@/core/brand'
import {
  type MissingEnvError,
  type ResolvedConfig,
  toMissingSearchKeyError,
} from '@/core/config/resolve'
import { missingCredentials } from '@/core/security/credentials'
import { resolveTradingConfig, unavailableSources } from '@/trading/api'

const API_TOKEN_SUBJECT = 'api'
const MCP_SUBJECT = 'mcp'
// With nothing set, every source that takes a key reads as unavailable: each one and its variable.
const NO_ENV: Readonly<Record<string, string | undefined>> = Object.freeze({})

/** Who a key variable serves: the provider, search provider, venue, source, channel or MCP server
 *  that reads it, or `api` for the API token. */
interface KeyEnvName {
  readonly name: string
  readonly subject: string
}

export type KeyEnvGroup = 'provider' | 'search' | 'venue' | 'source' | 'token' | 'mcp' | 'channel'

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
          params: {
            venue: { key: `trading.venue.${venue}` },
            variables: variables.join(', '),
            brand: BRAND.name,
          },
        },
      },
    ]
  })
}

/** Every variable the config reads a key from, set or not, by what it opens: the model chain and
 *  its tiers, web search, venue credentials, source keys, the API token, MCP placeholders and
 *  channel tokens. A name may appear in more than one group. */
export function keyEnvGroups(
  config: ResolvedConfig
): Readonly<Record<KeyEnvGroup, readonly KeyEnvName[]>> {
  const trading = resolveTradingConfig({ extensions: config.extensions, locale: config.locale })
  const models = [...config.models, ...Object.values(config.modelTiers).flat()]
  const { webSearch } = config

  return {
    provider: models.flatMap((model) => named(model.apiKeyEnv, model.provider)),
    search: [
      ...named(webSearch.apiKeyEnv, webSearch.provider),
      ...named(webSearch.fallbackApiKeyEnv, webSearch.fallback?.provider ?? webSearch.provider),
    ],
    venue: Object.entries(trading.venues).flatMap(([venue, settings]) =>
      Object.values(settings?.credentialEnv ?? {}).map((name) => ({ name, subject: venue }))
    ),
    source: unavailableSources({ env: NO_ENV, credentialEnv: trading.sourceCredentialEnv }).map(
      ({ source, variable }) => ({ name: variable, subject: source })
    ),
    token: named(config.api.tokenEnv, API_TOKEN_SUBJECT),
    mcp: config.mcp.envNames.map((name) => ({ name, subject: MCP_SUBJECT })),
    channel: Object.entries(config.channels).flatMap(([channel, settings]) =>
      named(channelTokenEnv(settings), channel)
    ),
  }
}

/** Every variable the config reads a key from, set or not: `keyEnvGroups` as one sorted list. */
export function keyEnvNames(config: ResolvedConfig): readonly string[] {
  const names = Object.values(keyEnvGroups(config)).flatMap((group) =>
    group.map((entry) => entry.name)
  )

  return [...new Set(names)].sort()
}

function named(name: string | undefined, subject: string): readonly KeyEnvName[] {
  return name === undefined ? [] : [{ name, subject }]
}

function channelTokenEnv(channel: unknown): string | undefined {
  if (typeof channel !== 'object' || channel === null || !('token_env' in channel)) {
    return undefined
  }

  return typeof channel.token_env === 'string' ? channel.token_env : undefined
}
