import type { Notifier, NotifyOutcome } from '@/channels/delivery/outbound/notifier'
import type { ChannelSettings } from '@/channels/schema'
import type { ChannelAdapter, ChannelRenderer, OutboundTarget } from '@/channels/types'
import { plainRenderer } from '@/channels/renderer'

interface ChunkedSendDeps {
  readonly notifier: Notifier
  readonly adapter: ChannelAdapter
  readonly settings: ChannelSettings
}

interface ChunkedSendOptions {
  readonly target: OutboundTarget
  readonly text: string
  /** Whether this path renders markup at all; the channel's own capability still decides. */
  readonly markup: boolean
  readonly signal?: AbortSignal
}

interface ChunkedSendResult {
  readonly outcome: NotifyOutcome
  /** One id per chunk that went out, in order; on a partial send, the chunks before the failure. */
  readonly messageIds: readonly string[]
}

/** Escaped chunks must be sent with `parse_mode` and plain chunks without: an escaped chunk sent as
 *  plain text reaches the chat as visible backslashes, and markup sent without `parse_mode` never
 *  renders. One owner for both decisions is what keeps them in agreement, on every send path. */
export function resolveOutboundMarkup(
  adapter: ChannelAdapter,
  settings: ChannelSettings,
  markup: boolean
): boolean {
  return markup && settings.markdown && adapter.capabilities.markdown === 'markdownv2'
}

/** The renderer whose encoding agrees with the `useMarkup` the send will carry: the adapter's
 *  escapes and splits for markup, so it must not feed a send that omits `parse_mode`. */
export function selectRenderer(adapter: ChannelAdapter, useMarkup: boolean): ChannelRenderer {
  return useMarkup ? adapter.renderer : plainRenderer
}

/** The one way text becomes sends. Anything longer than the transport's limit goes as ordered
 *  chunks rather than cut: a brief is several screens long, and a truncated one loses whichever
 *  market sorts last. Sequential, not `Promise.all` — the notifier queue is FIFO and single-flight,
 *  so awaiting in order keeps one message contiguous instead of interleaving with the next.
 *
 *  A chunk dropped midway leaves the earlier ones in the chat. That is the trade: the outcome
 *  reports the failure, the caller's state machine retries the whole thing, and a duplicate a
 *  reader recognises beats a silently lost tail. */
export async function sendChunked(
  deps: ChunkedSendDeps,
  options: ChunkedSendOptions
): Promise<ChunkedSendResult> {
  const { notifier, adapter, settings } = deps
  const { target, text, signal } = options
  const useMarkup = resolveOutboundMarkup(adapter, settings, options.markup)
  const chunks = selectRenderer(adapter, useMarkup).chunk(text, adapter.capabilities.maxTextLen)

  const messageIds: string[] = []

  for (const chunk of chunks) {
    const { outcome, ref } = await notifier.notify(target, chunk, {
      ...(signal === undefined ? {} : { signal }),
      ...(useMarkup ? { useMarkup: true as const } : {}),
    })

    if (outcome !== 'delivered') {
      return { outcome, messageIds }
    }

    if (ref !== undefined) {
      messageIds.push(ref.messageId)
    }
  }

  return { outcome: 'delivered', messageIds }
}
