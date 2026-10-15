import { OperatorConfigError } from '@/core/config/operator-errors'
import { isPathId } from '@/core/ids'

const TARGET_SEPARATOR = ':'

declare const CHANNEL_ID_BRAND: unique symbol

export type ChannelId = string & { readonly [CHANNEL_ID_BRAND]: true }

/** A delivery address, structurally the scheduler's DeliveryTarget (core may not import scheduler). */
export interface ChannelAddress {
  readonly channel: ChannelId
  readonly chatId: string
}

export function channelId(raw: string): ChannelId {
  if (!isPathId(raw)) {
    throw new OperatorConfigError(`invalid channel id '${raw}'`, {
      key: 'errors.channelIdInvalid',
      params: { value: raw },
    })
  }

  // why-safe: the shared path-id guard above is ChannelId's only invariant.
  return raw as ChannelId
}

export const LOCAL_CHANNEL_ID = channelId('cli')

/** The channel a social visit runs on. Tools read it to know a run was started by a network's
 *  heartbeat, never by the operator. */
export const SOCIAL_CHANNEL = channelId('social')

/**
 * `<channel>:<chatId>` — one token to type, one to validate. Split on the FIRST separator only:
 * a chat id may itself contain one. Registry membership is checked by the delivery surface.
 */
export function parseChannelAddress(raw: string): ChannelAddress {
  const cut = raw.indexOf(TARGET_SEPARATOR)

  if (cut < 0) {
    throw new OperatorConfigError(`delivery target must be <channel>:<chatId>, got '${raw}'`, {
      key: 'errors.deliveryTargetShape',
      params: { value: raw },
    })
  }

  const rawChannel = raw.slice(0, cut)
  const chatId = raw.slice(cut + 1).trim()

  if (chatId === '') {
    throw new OperatorConfigError(`delivery target has no chat id: '${raw}'`, {
      key: 'errors.deliveryTargetShape',
      params: { value: raw },
    })
  }

  return { channel: channelId(rawChannel), chatId }
}
