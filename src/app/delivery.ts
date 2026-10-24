import type {
  AcknowledgedRouter,
  AcknowledgedSendOptions,
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

type DeliveredListener = (message: SurfaceMessage, channels: readonly ChannelId[]) => void

/** The surfaces attached right now, by the channel id a notice is addressed to. */
export interface NoticeSurfaces {
  attach(channel: ChannelId, surface: NoticeSurface): () => void
  find(channel: ChannelId): NoticeSurface | undefined
  /** The first attached surface's channel, for a notice no channel recipient can take. */
  first(): ChannelId | undefined
}

export interface DeliveryHub {
  /** Told after every send that answered `accepted`, with the channels it went to: a router send or
   *  a surface alike. Returns the remove. */
  onDelivered(listener: DeliveredListener): () => void
  /** Bound into the scheduler and anything else that delivers proactively. Never changes identity. */
  readonly sink: DeliverySink
  readonly surfaces: NoticeSurfaces
  /** Where an unaddressed notice goes. Undefined until channels attach, and again after detach. */
  defaultRecipient(): DeliveryTarget | undefined
  /** False in any process that runs no channels, where `snapshots()` proves nothing about liveness. */
  attached(): boolean
  /** Every started channel's own default chat; empty while no daemon channels are attached. */
  recipients(): ReadonlyMap<ChannelId, DeliveryTarget>
  /** Whether a send to the target could land: an attached surface, or a started channel whose chat
   *  was not revoked. False while no daemon channels are attached. */
  isDeliverable(target: DeliveryTarget): Promise<boolean>
  /** Live channel lifecycle snapshots; empty while no daemon channels are attached. */
  snapshots(): readonly ChannelRuntimeSnapshot[]
  /** True while a channel runs a long slash command: work a restart would cut off. False with no
   *  channels. */
  isWorking(): boolean
  /** Files a message with the delivery listeners and sends it to no chat: the bell and a connected
   *  page see it, a channel does not. Nothing can fail, so it always answers `accepted`. */
  post(message: SurfaceMessage): 'accepted'
  /** Delivers and reports whether the send actually completed. The delivery state machines in
   *  trading are only correct if `accepted` means the sender call finished — `sink.notify` is
   *  fire-and-forget by comparison. */
  sendAcknowledged(
    target: DeliveryTarget,
    message: SurfaceMessage,
    options?: AcknowledgedSendOptions
  ): Promise<AcknowledgedSendResult>
  /** Called once the channels are up. Returns the disposer that detaches the router. */
  attach(options: {
    readonly notifier: AcknowledgedRouter
    readonly snapshots: () => readonly ChannelRuntimeSnapshot[]
    readonly isWorking: () => boolean
    readonly recipient: () => DeliveryTarget | undefined
    readonly recipients: () => ReadonlyMap<ChannelId, DeliveryTarget>
    readonly isDeliverable: (target: DeliveryTarget) => Promise<boolean>
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

/** What the attached channels answer for: the live reads the hub forwards. */
interface AttachedReaders {
  snapshots(): readonly ChannelRuntimeSnapshot[]
  isWorking(): boolean
  recipient(): DeliveryTarget | undefined
  recipients(): ReadonlyMap<ChannelId, DeliveryTarget>
  isDeliverable(target: DeliveryTarget): Promise<boolean>
}

interface DeliveredListeners {
  add(listener: DeliveredListener): () => void
  emit(message: SurfaceMessage, channels: readonly ChannelId[]): void
}

function createDeliveredListeners(): DeliveredListeners {
  const listeners = new Set<DeliveredListener>()

  return {
    add(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    emit(message, channels) {
      for (const listener of listeners) {
        try {
          listener(message, channels)
        } catch {
          // The hub has no logger, and a page that cannot take the message must never fail the
          // send that already reached its channel.
        }
      }
    },
  }
}

interface SenderParts {
  /** Read once per call: a detach racing the await would otherwise leave the second read null and
   *  turn a completed send into a thrown "no channel attached". */
  capture(): AcknowledgedRouter | null
  readonly surfaces: NoticeSurfaces
  readonly delivered: DeliveredListeners
}

function createSenders(
  parts: SenderParts
): Pick<DeliveryHub, 'sink' | 'sendAcknowledged' | 'post'> {
  const { surfaces, delivered } = parts

  return {
    post(message) {
      delivered.emit(message, [])

      return 'accepted'
    },

    sink: {
      async notify(target: DeliveryTarget, text: string): Promise<void> {
        const router = parts.capture()
        const surface = surfaces.find(target.channel)

        if (surface !== undefined) {
          if (surface.deliver({ text }) !== 'accepted') {
            throw new ChannelError('send_failed', `notification dropped for ${target.channel}`)
          }

          delivered.emit({ text }, [target.channel])

          return
        }

        if (router === null) {
          throw new ChannelError('not_initialized', `no channel attached for ${target.channel}`)
        }

        if ((await router(target, text)) !== 'accepted') {
          throw new ChannelError('send_failed', `notification dropped for ${target.channel}`)
        }

        delivered.emit({ text }, [target.channel])
      },
    },

    async sendAcknowledged(target, message, options): Promise<AcknowledgedSendResult> {
      const router = parts.capture()
      const surface = surfaces.find(target.channel)
      const result =
        surface === undefined
          ? await sendViaRouter(router, { target, message, options })
          : surface.deliver(message)

      if (result === 'accepted') {
        delivered.emit(message, [target.channel])
      }

      return result
    },
  }
}

function sendViaRouter(
  router: AcknowledgedRouter | null,
  send: {
    readonly target: DeliveryTarget
    readonly message: SurfaceMessage
    readonly options: AcknowledgedSendOptions | undefined
  }
): Promise<AcknowledgedSendResult> {
  return router === null
    ? Promise.resolve('unavailable')
    : router(send.target, send.message.text, send.options)
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
  let readers: AttachedReaders | null = null

  const surfaces = createNoticeSurfaces()
  const delivered = createDeliveredListeners()

  return {
    surfaces,
    ...createSenders({ capture: () => notifier, surfaces, delivered }),
    onDelivered: delivered.add,

    // A channel's own default chat first; with none attached, a surface that shows everything.
    defaultRecipient: () => {
      const channel = surfaces.first()

      return (
        readers?.recipient() ??
        (channel === undefined ? undefined : { channel, chatId: SURFACE_CHAT_ID })
      )
    },
    attached: () => readers !== null,
    recipients: () => readers?.recipients() ?? new Map(),
    isDeliverable: async (target) =>
      surfaces.find(target.channel) !== undefined ||
      ((await readers?.isDeliverable(target)) ?? false),
    snapshots: () => readers?.snapshots() ?? [],
    isWorking: () => readers?.isWorking() ?? false,

    attach(options): () => Promise<void> {
      notifier = options.notifier
      readers = options

      return () => {
        // Both: a detached channel must leave no router and no recipient behind. The queues belong
        // to the channel runtimes, which dispose themselves — this hub owns no queue to drain.
        notifier = null
        readers = null

        return Promise.resolve()
      }
    },
  }
}
