import { hostname, userInfo } from 'node:os'

const SSH_CONNECTION_FIELDS = 4
const SSH_DEFAULT_PORT = 22
const WHOLE_NUMBER = /^\d+$/
const WHITESPACE = /\s+/

/** How the operator reached this machine, read from the SSH session's environment. */
export interface SshAddress {
  readonly user: string
  readonly host: string
  /** Set only when the server listens on a port other than 22. */
  readonly port?: number
  /** The host name stands in because `SSH_CONNECTION` was absent or unreadable. */
  readonly guessed: boolean
  readonly overSsh: boolean
}

/** `SSH_CONNECTION` is "<client ip> <client port> <server ip> <server port>". */
export function resolveSshAddress(env: Readonly<Record<string, string | undefined>>): SshAddress {
  const user = env.USER ?? userInfo().username
  const connection = env.SSH_CONNECTION ?? ''
  const overSsh = connection !== ''
  const fields = connection.trim().split(WHITESPACE)
  const [, , host, port] = fields

  if (
    fields.length !== SSH_CONNECTION_FIELDS ||
    host === undefined ||
    port === undefined ||
    !WHOLE_NUMBER.test(port)
  ) {
    return { user, host: hostname(), guessed: true, overSsh }
  }

  const portNumber = Number(port)

  return {
    user,
    host,
    ...(portNumber === SSH_DEFAULT_PORT ? {} : { port: portNumber }),
    guessed: false,
    overSsh,
  }
}
