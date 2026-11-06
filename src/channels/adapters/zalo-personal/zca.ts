import type * as Zca from 'zca-js'

import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/operator-errors'
import { assertNotAborted } from '@/core/errors'

import { ZALO_PERSONAL_CHANNEL_ID } from './config'

export type ZcaModule = typeof Zca

// The package is read when the channel starts or an account is linked, so a daemon or command
// without Zalo Personal never loads it. A failed load leaves the channel down with a reason the
// operator can act on; an abort during the load ends the start before anything is armed.
export async function loadZca(signal: AbortSignal): Promise<ZcaModule> {
  assertNotAborted(signal)

  let zca: ZcaModule

  try {
    zca = await import('zca-js')
  } catch (err: unknown) {
    throw new OperatorConfigError(
      `${ZALO_PERSONAL_CHANNEL_ID}: zca-js failed to load`,
      {
        key: 'errors.channelLibraryUnavailable',
        params: {
          channel: { key: `ui.channelName.${ZALO_PERSONAL_CHANNEL_ID}`, fallback: 'Zalo' },
          brand: BRAND.name,
        },
      },
      { cause: err, path: ['channels', ZALO_PERSONAL_CHANNEL_ID] }
    )
  }

  assertNotAborted(signal)

  return zca
}
