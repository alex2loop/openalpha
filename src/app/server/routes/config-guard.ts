import { buildProviderCatalog } from '@/app/server/cli/catalog'
import { isPlainRecord } from '@/core/utils/collections'

type ConfigTree = Record<string, unknown>

/** What a secret reads as on GET /v1/config; sent back unchanged on a write, it keeps the value. */
export const REDACTED_SECRET = '********'

/** Changed only from the CLI or config.toml, never through the API: each one decides what the
 *  daemon runs, which files it touches or where a key is sent, so a leaked page token must not
 *  reach them. Every field naming an environment variable is one: the names on disk are what
 *  `/v1/credentials` may write. A value equal to the file's passes. */
const CLI_ONLY_SECTIONS: readonly string[] = ['plugins', 'paths', 'storage', 'api', 'update']
const CLI_ONLY_PATHS: readonly (readonly string[])[] = [
  ...CLI_ONLY_SECTIONS.map((section) => [section]),
  ['log', 'file'],
  ['trading', 'orders', 'allow_unattended'],
  // Each value names the variable a source key is read from, as a `*_env` key does.
  ['trading', 'sources'],
]
/** `[trading.venues.<id>] credentials`: the variables a venue's keys are read from. */
const VENUES_PATH: readonly string[] = ['trading', 'venues']
const VENUE_CREDENTIALS_KEY = 'credentials'
const CHANNELS_SECTION = 'channels'
/** What decides who talks to the daemon through a channel or where it writes. While the API is
 *  reachable from outside (`[api] public_url`) they change only on the server: a channel with no
 *  allowlist pairs, pairing approval is server-only then too, and the fallback chat receives every
 *  proactive message. Mirrors the access keys in `channels/schema.ts` and each adapter's
 *  `config.ts`; a new one is added here. */
const CHANNEL_ACCESS_KEYS: readonly string[] = [
  'allowed_ids',
  'operator_user_ids',
  'pairing',
  'dm_policy',
  'fallback_chat_id',
]
const MCP_SECTION = 'mcp'
const MODEL_DEFAULTS_SECTION = 'model_defaults'
const MCP_SERVERS_PATH: readonly string[] = [MCP_SECTION, 'servers']
const MCP_SERVER_CLI_ONLY_KEYS: readonly string[] = ['transport', 'command', 'args', 'env', 'url']
/** Anywhere in the tree. A write may drop one (the provider's own address and key variable take
 *  over), never add or change it. */
const ENDPOINT_KEYS: ReadonlySet<string> = new Set(['base_url', 'fallback_base_url'])
const KEY_VAR_SUFFIX = '_env'
/** A channel's `token_file`: the file its bot token is read from, so a key naming one is held to
 *  the same rule as a key naming a variable. */
const SECRET_FILE_SUFFIX = '_file'
/** The model picker sets a provider's own key variable when it switches provider. */
const PROVIDER_KEY_VAR = 'api_key_env'
/** Sections the rules above already cover, so the walk does not report them twice. */
const WALK_SKIPPED_SECTIONS: ReadonlySet<string> = new Set([...CLI_ONLY_SECTIONS, MCP_SECTION])
const SECRET_KEY_RE = /token|secret|password|api_key/i
/** An MCP server's `env` table and `args` list: every value in them is a literal it reads. */
const SECRET_TABLE_KEYS: ReadonlySet<string> = new Set(['env', 'args'])
/** An MCP server's address, the only `url` key in the tree: a hosted server's key often rides in
 *  its query. */
const SECRET_URL_KEY = 'url'
const PROVIDER_KEY_VARS: ReadonlyMap<string, string> = new Map(
  buildProviderCatalog().providers.map((provider) => [provider.id, provider.envVar])
)

/** The tree with every literal secret replaced by `REDACTED_SECRET`. */
export function toRedactedConfig(tree: unknown): unknown {
  return toRedacted(tree, false)
}

/** `REDACTED_SECRET` put back to the file's value wherever the file has one. */
export function toRestoredConfig(body: unknown, disk: unknown): unknown {
  if (body === REDACTED_SECRET) {
    return typeof disk === 'string' ? disk : body
  }

  if (Array.isArray(body)) {
    return body.map((item, index) => toRestoredConfig(item, counterpartAt(disk, item, index)))
  }

  if (!isPlainRecord(body)) {
    return body
  }

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, toRestoredConfig(value, memberOf(disk, key))])
  )
}

/** Where `REDACTED_SECRET` still stands after a restore: a secret the file does not hold. */
export function redactedPaths(tree: unknown, path = ''): readonly string[] {
  if (tree === REDACTED_SECRET) {
    return [path]
  }

  if (Array.isArray(tree)) {
    return tree.flatMap((item, index) => redactedPaths(item, childPath(path, index)))
  }

  return isPlainRecord(tree)
    ? Object.entries(tree).flatMap(([key, value]) => redactedPaths(value, childPath(path, key)))
    : []
}

/** Every CLI-only value `body` changes against the file, by its path in the body. */
export function cliOnlyChanges(body: ConfigTree, disk: ConfigTree): readonly string[] {
  return [
    ...CLI_ONLY_PATHS.filter(
      (path) => !Bun.deepEquals(valueAt(body, path), valueAt(disk, path))
    ).map((path) => path.join('.')),
    ...mcpServerChanges(body, disk),
    ...venueCredentialChanges(body, disk),
    ...endpointChanges(body, disk),
  ]
}

function venueCredentialChanges(body: ConfigTree, disk: ConfigTree): readonly string[] {
  const venues = valueAt(body, VENUES_PATH)
  const before = valueAt(disk, VENUES_PATH)
  const ids = new Set([...recordKeys(venues), ...recordKeys(before)])

  return [...ids]
    .filter(
      (id) =>
        !Bun.deepEquals(
          valueAt(venues, [id, VENUE_CREDENTIALS_KEY]),
          valueAt(before, [id, VENUE_CREDENTIALS_KEY])
        )
    )
    .map((id) => [...VENUES_PATH, id, VENUE_CREDENTIALS_KEY].join('.'))
}

/** Every channel access key `body` changes against the file, by its path in the body. */
export function exposedOnlyChanges(body: ConfigTree, disk: ConfigTree): readonly string[] {
  const channels = memberOf(body, CHANNELS_SECTION)
  const before = memberOf(disk, CHANNELS_SECTION)
  const ids = new Set([...recordKeys(channels), ...recordKeys(before)])

  return [...ids].flatMap((id) =>
    CHANNEL_ACCESS_KEYS.filter(
      (key) => !Bun.deepEquals(valueAt(channels, [id, key]), valueAt(before, [id, key]))
    ).map((key) => [CHANNELS_SECTION, id, key].join('.'))
  )
}

function recordKeys(value: unknown): readonly string[] {
  return isPlainRecord(value) ? Object.keys(value) : []
}

function toRedacted(value: unknown, isSecret: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toRedacted(item, isSecret))
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, held]) => [
        key,
        toRedacted(held, isSecret || SECRET_TABLE_KEYS.has(key) || isSecretKey(key)),
      ])
    )
  }

  return isSecret && typeof value === 'string' ? REDACTED_SECRET : value
}

// `api_key_env` names a variable, not a secret.
function isSecretKey(key: string): boolean {
  return key === SECRET_URL_KEY || (SECRET_KEY_RE.test(key) && !key.endsWith(KEY_VAR_SUFFIX))
}

function mcpServerChanges(body: ConfigTree, disk: ConfigTree): readonly string[] {
  const servers = valueAt(body, MCP_SERVERS_PATH)
  const before = valueAt(disk, MCP_SERVERS_PATH)

  if (!Array.isArray(servers)) {
    return []
  }

  return servers.flatMap((server: unknown, index) => {
    const was = counterpartAt(before, server, index)
    const path = childPath(MCP_SERVERS_PATH.join('.'), index)

    return MCP_SERVER_CLI_ONLY_KEYS.filter(
      (key) => !Bun.deepEquals(memberOf(server, key), memberOf(was, key))
    ).map((key) => childPath(path, key))
  })
}

function endpointChanges(root: ConfigTree, disk: ConfigTree): readonly string[] {
  const defaults = memberOf(root, MODEL_DEFAULTS_SECTION)

  function walk(body: unknown, was: unknown, path: string): readonly string[] {
    if (Array.isArray(body)) {
      return body.flatMap((item, index) =>
        walk(item, counterpartAt(was, item, index), childPath(path, index))
      )
    }

    if (!isPlainRecord(body)) {
      return []
    }

    return Object.entries(body).flatMap(([key, value]) => {
      const at = childPath(path, key)

      if (path === '' && WALK_SKIPPED_SECTIONS.has(key)) {
        return []
      }

      if (!isEndpointKey(key)) {
        return walk(value, memberOf(was, key), at)
      }

      return Bun.deepEquals(value, memberOf(was, key)) || isProviderKeyVar(body, key, defaults)
        ? []
        : [at]
    })
  }

  return walk(root, disk, '')
}

function isEndpointKey(key: string): boolean {
  return ENDPOINT_KEYS.has(key) || key.endsWith(KEY_VAR_SUFFIX) || key.endsWith(SECRET_FILE_SUFFIX)
}

/** The provider's own key variable, set where the key goes to the provider's own address: an
 *  entry with an address of its own, or one inheriting `[model_defaults]`'s (only an entry of the
 *  defaults' provider does, as in `connectionDefaults`), would send it somewhere else. */
function isProviderKeyVar(entry: ConfigTree, key: string, defaults: unknown): boolean {
  const provider = entry.provider

  return (
    key === PROVIDER_KEY_VAR &&
    typeof provider === 'string' &&
    PROVIDER_KEY_VARS.get(provider) === entry[key] &&
    !hasEndpoint(entry) &&
    !(provider === memberOf(defaults, 'provider') && hasEndpoint(defaults))
  )
}

function hasEndpoint(value: unknown): boolean {
  return [...ENDPOINT_KEYS].some((key) => memberOf(value, key) !== undefined)
}

/** The file's item an array item stands for: the one with the same `name`, else the same place. */
function counterpartAt(disk: unknown, item: unknown, index: number): unknown {
  if (!Array.isArray(disk)) {
    return undefined
  }

  const name = memberOf(item, 'name')

  return typeof name === 'string'
    ? disk.find((held: unknown) => memberOf(held, 'name') === name)
    : disk[index]
}

function valueAt(tree: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((held, key) => memberOf(held, key), tree)
}

function memberOf(value: unknown, key: string): unknown {
  return isPlainRecord(value) ? value[key] : undefined
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${path}[${key}]`
  }

  return path === '' ? key : `${path}.${key}`
}
