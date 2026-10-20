import type { ChannelId } from '@/core/channels'
import { BRAND } from '@/core/brand'
import { OperatorConfigError, setEnvCommand } from '@/core/config/resolve'

/** The channel a token error names: its config id and the name the operator knows it by. */
interface TokenOwner {
  readonly id: ChannelId
  readonly label: string
}

/** A channel switched on with no token to log in with: it stays down until one is set. With a
 *  `token_env` the message names the command that saves it. */
export function toTokenMissingError(
  owner: TokenOwner,
  tokenEnv: string | undefined
): OperatorConfigError {
  const message = `${owner.id}: no bot token resolved (set channels.${owner.id}.token_env or token_file)`
  const path = ['channels', owner.id, 'token_env']

  if (tokenEnv !== undefined) {
    return new OperatorConfigError(
      message,
      {
        key: 'errors.channelTokenMissingEnv',
        params: { channel: owner.label, command: setEnvCommand(tokenEnv), brand: BRAND.name },
      },
      { path }
    )
  }

  return new OperatorConfigError(
    message,
    {
      key: 'errors.channelTokenMissing',
      params: { channel: owner.label, section: `channels.${owner.id}`, brand: BRAND.name },
    },
    { path }
  )
}

/** The platform refused the token at login; `detail` is its answer, for the log only. */
export function toTokenRejectedError(owner: TokenOwner, detail: string): OperatorConfigError {
  return new OperatorConfigError(
    `${owner.id}: bot token rejected (${detail})`,
    {
      key: 'errors.channelTokenRejected',
      params: { channel: owner.label, brand: BRAND.name },
    },
    { path: ['channels', owner.id, 'token_env'] }
  )
}
