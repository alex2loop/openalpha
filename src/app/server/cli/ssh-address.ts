import { hostname, userInfo } from 'node:os'

const SSH_CONNECTION_FIELDS = 4
const SSH_DEFAULT_PORT = 22
const WHOLE_NUMBER = /^\d+$/
const WHITESPACE = /\s+/

/** How the operator reached this machine, read from the SSH session's environment. */
export interface SshAddress {
  /** Unset when neither `USER` nor the account database names one; ssh then uses the local login. */
  readonly user?: string
  readonly host: string
  /** Set only when the server listens on a port other than 22. */
  readonly port?: number
  /** The host name stands in because `SSH_CONNECTION` was absent or unreadable. */
  readonly guessed: boolean
  readonly overSsh: boolean
}

/** `SSH_CONNECTION` is "<client ip> <client port> <server ip> <server port>". */
export function resolveSshAddress(env: Readonly<Record<string, string | undefined>>): SshAddress {
  const user = resolveUser(env)
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
    return { ...user, host: hostname(), guessed: true, overSsh }
  }

  const portNumber = Number(port)

  return {
    ...user,
    host,
    ...(portNumber === SSH_DEFAULT_PORT ? {} : { port: portNumber }),
    guessed: false,
    overSsh,
  }
}

/** `user@host`, or the bare host when the user is unknown. */
export function toSshTarget(user: string | undefined, host: string): string {
  return user === undefined ? host : `${user}@${host}`
}

/** An empty `USER` counts as unset; a uid with no account entry makes `userInfo()` throw. */
function resolveUser(env: Readonly<Record<string, string | undefined>>): {
  readonly user?: string
} {
  if (env.USER !== undefined && env.USER !== '') {
    return { user: env.USER }
  }

  try {
    return { user: userInfo().username }
  } catch {
    return {}
  }
}
