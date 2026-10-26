import { buildProviderCatalog } from '@/app/server/cli/catalog'
import { isPlainRecord } from '@/core/utils/collections'

type ConfigTree = Record<string, unknown>

/** What a secret reads as on GET /v1/config; sent back unchanged on a write, it keeps the value. */
export const REDACTED_SECRET = '********'

/** Changed only from the CLI or config.toml, never through the API: each one decides what the
 *  daemon runs, which files it touches or where a key is sent, so a leaked page token must not
 *  reach them. A value equal to the file's passes. */
const CLI_ONLY_SECTIONS: readonly string[] = ['plugins', 'paths', 'storage']
const CLI_ONLY_PATHS: readonly (readonly string[])[] = [
  ...CLI_ONLY_SECTIONS.map((section) => [section]),
  ['log', 'file'],
]
const MCP_SECTION = 'mcp'
const MCP_SERVERS_PATH: readonly string[] = [MCP_SECTION, 'servers']
const MCP_SERVER_CLI_ONLY_KEYS: readonly string[] = ['transport', 'command', 'args', 'env']
/** Anywhere in the tree. A write may drop one (the provider's own address and key variable take
 *  over), never add or change it. */
const ENDPOINT_KEYS: ReadonlySet<string> = new Set(['base_url', 'fallback_base_url'])
const KEY_VAR_SUFFIX = '_env'
/** The model picker sets a provider's own key variable when it switches provider. */
const PROVIDER_KEY_VAR = 'api_key_env'
/** Sections the rules above already cover, so the walk does not report them twice. */
const WALK_SKIPPED_SECTIONS: ReadonlySet<string> = new Set([...CLI_ONLY_SECTIONS, MCP_SECTION])
const SECRET_KEY_RE = /token|secret|password|api_key/i
/** An MCP server's `env` table: every value in it is a literal the server reads. */
const SECRET_TABLE_KEY = 'env'
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
    ...endpointChanges(body, disk, ''),
  ]
}

function toRedacted(value: unknown, isSecret: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toRedacted(item, isSecret))
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, held]) => [
        key,
        toRedacted(held, isSecret || key === SECRET_TABLE_KEY || isSecretKey(key)),
      ])
    )
  }

  return isSecret && typeof value === 'string' ? REDACTED_SECRET : value
}

// `api_key_env` names a variable, not a secret.
function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) && !key.endsWith(KEY_VAR_SUFFIX)
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

function endpointChanges(body: unknown, disk: unknown, path: string): readonly string[] {
  if (Array.isArray(body)) {
    return body.flatMap((item, index) =>
      endpointChanges(item, counterpartAt(disk, item, index), childPath(path, index))
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
      return endpointChanges(value, memberOf(disk, key), at)
    }

    return Bun.deepEquals(value, memberOf(disk, key)) || isProviderKeyVar(body, key) ? [] : [at]
  })
}

function isEndpointKey(key: string): boolean {
  return ENDPOINT_KEYS.has(key) || key.endsWith(KEY_VAR_SUFFIX)
}

function isProviderKeyVar(entry: ConfigTree, key: string): boolean {
  const provider = entry.provider

  return (
    key === PROVIDER_KEY_VAR &&
    typeof provider === 'string' &&
    PROVIDER_KEY_VARS.get(provider) === entry[key]
  )
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
