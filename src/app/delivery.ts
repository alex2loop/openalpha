import type {
  AcknowledgedRouter,
  AcknowledgedSendResult,
  ChannelRuntimeSnapshot,
} from '@/channels/api'
import type { ChannelId } from '@/core/channels'
import type { DeliverySink, DeliveryTarget } from '@/scheduler/api'
import type { TradingNotice } from '@/trading/api'
import { ChannelError } from '@/core/errors'

/** The chat id an unaddressed message carries to a surface, which has no chats of its own. */
const SURFACE_CHAT_ID = 'app'

/** What a surface is handed: the text a chat would get, and the typed notice behind it where the
 *  sender was trading. A scheduled job's result carries text only. */
interface SurfaceMessage {
  readonly text: string
  readonly notice?: TradingNotice
}

/** A surface the daemon pushes to without a chat channel: an app, through the api server.
 *  It answers `unavailable` while nobody is listening, so a sender retries the way it would for an
 *  offline channel. It shows every message whatever chat id the target names. */
interface NoticeSurface {
  deliver(message: SurfaceMessage): AcknowledgedSendResult
}

/** The surfaces attached right now, by the channel id a notice is addressed to. */
export interface NoticeSurfaces {
  attach(channel: ChannelId, surface: NoticeSurface): () => void
  find(channel: ChannelId): NoticeSurface | undefined
  /** The first attached surface's channel, for a notice no channel recipient can take. */
  first(): ChannelId | undefined
}

export interface DeliveryHub {
  /** Bound into the scheduler and anything else that delivers proactively. Never changes identity. */
  readonly sink: DeliverySink
  readonly surfaces: NoticeSurfaces
  /** Where an unaddressed notice goes. Undefined until channels attach, and again after detach. */
  defaultRecipient(): DeliveryTarget | undefined
  /** False in any process that runs no channels, where `snapshots()` proves nothing about liveness. */
  attached(): boolean
  /** Live channel lifecycle snapshots; empty while no daemon channels are attached. */
  snapshots(): readonly ChannelRuntimeSnapshot[]
  /** True while a channel runs a long slash command a restart would cut off; false with no channels. */
  isBusy(): boolean
  /** Delivers and reports whether the send actually completed. The delivery state machines in
   *  trading are only correct if `accepted` means the sender call finished — `sink.notify` is
   *  fire-and-forget by comparison. */
  sendAcknowledged(
    target: DeliveryTarget,
    message: SurfaceMessage,
    signal?: AbortSignal
  ): Promise<AcknowledgedSendResult>
  /** Called once the channels are up. Returns the disposer that detaches the router. */
  attach(options: {
    readonly notifier: AcknowledgedRouter
    readonly snapshots: () => readonly ChannelRuntimeSnapshot[]
    readonly isBusy: () => boolean
    readonly recipient?: DeliveryTarget
  }): () => Promise<void>
}

function createNoticeSurfaces(): NoticeSurfaces {
  const attached = new Map<ChannelId, NoticeSurface>()

  return {
    attach(channel, surface) {
      attached.set(channel, surface)

      return () => {
        if (attached.get(channel) === surface) {
          attached.delete(channel)
        }
      }
    },
    find: (channel) => attached.get(channel),
    first: () => attached.keys().next().value,
  }
}

/**
 * The seam between "who wants to deliver" and "who can". The scheduler binds its `DeliverySink` when
 * the container is assembled, but no adapter exists until the daemon starts the channels — so the
 * sink is a stable indirection whose backing router is attached later, and detached on shutdown.
 * Before attach (and after detach) a notice fails rather than queue forever: a cli process has no
 * channel to deliver to, and holding the notice would leak it. The rejection is what lets the
 * scheduler record a delivery error instead of finalizing a silently lost result.
 */
export function createDeliveryHub(): DeliveryHub {
  let notifier: AcknowledgedRouter | null = null
  let recipient: DeliveryTarget | undefined
  let readSnapshots: (() => readonly ChannelRuntimeSnapshot[]) | null = null
  let readBusy: (() => boolean) | null = null

  // Read once per call: a detach racing the await would otherwise leave the second read null and
  // turn a completed send into a thrown "no channel attached".
  const capture = (): AcknowledgedRouter | null => notifier

  const surfaces = createNoticeSurfaces()

  return {
    surfaces,
    sink: {
      async notify(target: DeliveryTarget, text: string): Promise<void> {
        const router = capture()
        const surface = surfaces.find(target.channel)

        if (surface !== undefined) {
          if (surface.deliver({ text }) !== 'accepted') {
            throw new ChannelError('send_failed', `notification dropped for ${target.channel}`)
          }

          return
        }

        if (router === null) {
          throw new ChannelError('not_initialized', `no channel attached for ${target.channel}`)
        }

        if ((await router(target, text)) !== 'accepted') {
          throw new ChannelError('send_failed', `notification dropped for ${target.channel}`)
        }
      },
    },

    async sendAcknowledged(target, message, signal): Promise<AcknowledgedSendResult> {
      const router = capture()
      const surface = surfaces.find(target.channel)

      if (surface !== undefined) {
        return surface.deliver(message)
      }

      return router === null ? 'unavailable' : router(target, message.text, signal)
    },

    // A channel's own default chat first; with none attached, a surface that shows everything.
    defaultRecipient: () => {
      const channel = surfaces.first()

      return recipient ?? (channel === undefined ? undefined : { channel, chatId: SURFACE_CHAT_ID })
    },
    attached: () => readSnapshots !== null,
    snapshots: () => readSnapshots?.() ?? [],
    isBusy: () => readBusy?.() ?? false,

    attach(options): () => Promise<void> {
      notifier = options.notifier
      recipient = options.recipient
      readSnapshots = options.snapshots
      readBusy = options.isBusy

      return () => {
        // Both: a detached channel must not leave a stale address behind. The queues belong to the
        // channel runtimes, which dispose themselves — this hub owns no queue to drain.
        notifier = null
        recipient = undefined
        readSnapshots = null
        readBusy = null

        return Promise.resolve()
      }
    },
  }
}
