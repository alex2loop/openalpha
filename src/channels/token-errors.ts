import type { ChannelId } from '@/core/channels'
import { OperatorConfigError } from '@/core/config/resolve'

/** The channel a token error names: its config id and the name the operator knows it by. */
interface TokenOwner {
  readonly id: ChannelId
  readonly label: string
}

/** A channel switched on with no token to log in with: it stays down until one is set. */
export function toTokenMissingError(owner: TokenOwner): OperatorConfigError {
  return new OperatorConfigError(
    `${owner.id}: no bot token resolved (set channels.${owner.id}.token_env or token_file)`,
    {
      key: 'errors.channelTokenMissing',
      params: { channel: owner.label, section: `channels.${owner.id}` },
    },
    { path: ['channels', owner.id, 'token_env'] }
  )
}

/** The platform refused the token at login; `detail` is its answer, for the log only. */
export function toTokenRejectedError(owner: TokenOwner, detail: string): OperatorConfigError {
  return new OperatorConfigError(
    `${owner.id}: bot token rejected (${detail})`,
    { key: 'errors.channelTokenRejected', params: { channel: owner.label } },
    { path: ['channels', owner.id, 'token_env'] }
  )
}
