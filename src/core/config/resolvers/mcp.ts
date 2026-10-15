import type { RawMcp } from '@/core/config/schema'
import { MissingEnvError, OperatorConfigError } from '@/core/config/operator-errors'

export type ResolvedMcpServer =
  | {
      readonly name: string
      readonly transport: 'stdio'
      readonly command: string
      readonly args: readonly string[]
      readonly env: Readonly<Record<string, string>>
    }
  | { readonly name: string; readonly transport: 'http'; readonly url: string }

export interface ResolvedMcp {
  readonly servers: readonly ResolvedMcpServer[]
}

const PLACEHOLDER_RE = /\$\{([^}]*)\}/g
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

// A server disabled in config is dropped here, so nothing downstream has to re-check the flag.
export function resolveMcp(raw: RawMcp | undefined): ResolvedMcp {
  const seen = new Set<string>()
  const servers = (raw?.servers ?? [])
    .map((server, index) => ({ server, index }))
    .filter(({ server }) => server.enabled !== false)
    .map(({ server, index }): ResolvedMcpServer => {
      if (seen.has(server.name)) {
        throw new OperatorConfigError(
          `mcp server "${server.name}" is declared twice`,
          { key: 'errors.configMcpDuplicate', params: { server: server.name } },
          { path: ['mcp', 'servers', index, 'name'] }
        )
      }

      seen.add(server.name)

      if (server.transport === 'stdio') {
        return {
          name: server.name,
          transport: 'stdio',
          command: interpolateEnv(server.command, server.name, [
            'mcp',
            'servers',
            index,
            'command',
          ]),
          args:
            server.args?.map((arg, argIndex) =>
              interpolateEnv(arg, server.name, ['mcp', 'servers', index, 'args', argIndex])
            ) ?? [],
          env: Object.fromEntries(
            Object.entries(server.env ?? {}).map(([key, value]) => [
              key,
              interpolateEnv(value, server.name, ['mcp', 'servers', index, 'env', key]),
            ])
          ),
        }
      }

      const url = interpolateEnv(server.url, server.name, ['mcp', 'servers', index, 'url'])
      assertMcpUrl(url, server.name, ['mcp', 'servers', index, 'url'])

      return {
        name: server.name,
        transport: 'http',
        url,
      }
    })

  return { servers }
}

function assertMcpUrl(raw: string, serverName: string, path: readonly (string | number)[]): void {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    // Neither the expanded value nor the parser's cause is reported: either can carry an env token.
    throw new OperatorConfigError(
      `mcp server "${serverName}": url is not a valid URL`,
      {
        key: 'errors.configMcpUrlInvalid',
        params: { server: serverName },
      },
      { path: path }
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OperatorConfigError(
      `mcp server "${serverName}": url must use http or https (got ${url.protocol})`,
      { key: 'errors.configMcpUrlProtocol', params: { server: serverName } },
      { path: path }
    )
  }
}

// An unset or empty placeholder would reach the server as a late, silent auth failure. Only the
// template is scanned: an env value may itself contain `${`.
function interpolateEnv(
  value: string,
  serverName: string,
  path: readonly (string | number)[]
): string {
  return value.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!ENV_NAME_RE.test(name)) {
      throw new OperatorConfigError(
        `mcp server "${serverName}": unrecognized placeholder in value`,
        {
          key: 'errors.configMcpPlaceholder',
          params: { server: serverName },
        },
        { path: path }
      )
    }

    const resolved = process.env[name]

    if (resolved === undefined || resolved === '') {
      throw new MissingEnvError(name, `mcp server "${serverName}"`, path)
    }

    return resolved
  })
}
