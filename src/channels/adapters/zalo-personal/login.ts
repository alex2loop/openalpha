import { rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { LoginQRCallbackEvent } from 'zca-js'
import { LoginQRCallbackEventType, Zalo, ZaloApiLoginQRAborted } from 'zca-js'

import { assertNotAborted } from '@/core/errors'
import { ensurePrivateDirectory, PRIVATE_FILE_MODE } from '@/core/security/private-files'

import {
  type ProfileLocation,
  resolveQrCodePath,
  writeZaloPersonalCredentials,
} from './credentials'
import { resolveBotName } from './listener'

export type ZaloPersonalLoginProgress =
  | { readonly kind: 'qr-ready'; readonly path: string }
  | { readonly kind: 'scanned'; readonly name: string }

export type ZaloPersonalLoginOutcome =
  | { readonly kind: 'linked'; readonly name: string }
  | { readonly kind: 'declined' }
  | { readonly kind: 'expired' }

interface LoginZaloPersonalOptions {
  readonly location: ProfileLocation
  /** Aborting it ends the wait for a scan, and the outcome is `expired`. */
  readonly signal: AbortSignal
  readonly onProgress: (progress: ZaloPersonalLoginProgress) => void
}

// zca-js hands each QR its own abort, so the latest one is kept to end the wait from outside.
interface QrFlow {
  readonly options: LoginZaloPersonalOptions
  readonly qrPath: string
  abort: (() => unknown) | undefined
  declined: boolean
  failure: unknown
}

/** Links a personal Zalo account by QR and stores its session where the channel reads it. */
export async function loginZaloPersonal(
  options: LoginZaloPersonalOptions
): Promise<ZaloPersonalLoginOutcome> {
  assertNotAborted(options.signal)

  const flow: QrFlow = {
    options,
    qrPath: resolveQrCodePath(options.location),
    abort: undefined,
    declined: false,
    failure: undefined,
  }
  const onAbort = (): void => {
    flow.abort?.()
  }

  options.signal.addEventListener('abort', onAbort, { once: true })

  try {
    const api = await new Zalo({ logging: false }).loginQR(undefined, (event) =>
      onQrEvent(flow, event)
    )

    await writeZaloPersonalCredentials(options.location, api)

    return { kind: 'linked', name: await resolveBotName(api) }
  } catch (err: unknown) {
    if (flow.failure !== undefined || !(err instanceof ZaloApiLoginQRAborted)) {
      throw flow.failure ?? err
    }

    return flow.declined ? { kind: 'declined' } : { kind: 'expired' }
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    await rm(flow.qrPath, { force: true })
  }
}

function onQrEvent(flow: QrFlow, event: LoginQRCallbackEvent): void {
  if (event.actions !== null) {
    flow.abort = event.actions.abort
  }

  if (flow.options.signal.aborted) {
    flow.abort?.()
    return
  }

  switch (event.type) {
    case LoginQRCallbackEventType.QRCodeGenerated:
      writeQrCode(flow.qrPath, event.data.image)
        .then(() => flow.options.onProgress({ kind: 'qr-ready', path: flow.qrPath }))
        .catch((err: unknown) => {
          flow.failure = err
          flow.abort?.()
        })
      return
    case LoginQRCallbackEventType.QRCodeExpired:
      // A QR lives about 100 seconds; a fresh one keeps the wait going until the caller's signal.
      event.actions.retry()
      return
    case LoginQRCallbackEventType.QRCodeScanned:
      flow.options.onProgress({ kind: 'scanned', name: event.data.display_name })
      return
    case LoginQRCallbackEventType.QRCodeDeclined:
      // zca-js leaves a declined login waiting for retry or abort; it never settles on its own.
      flow.declined = true
      event.actions.abort()
      return
    case LoginQRCallbackEventType.GotLoginInfo:
      return
    default:
      event satisfies never
  }
}

async function writeQrCode(path: string, base64Png: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path))
  await writeFile(path, Buffer.from(base64Png, 'base64'), { mode: PRIVATE_FILE_MODE })
}
