import type { DeliveryHub } from '@/app/delivery'
import type { ChannelRuntimeSnapshot } from '@/channels/api'
import type { ChannelId } from '@/core/channels'
import type { DaemonStartOptions, DegradedItem } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import { toHealthCode } from '@/app/views'
import { BRAND } from '@/core/brand'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { t } from '@/i18n'

const CHANNEL_WATCH_INTERVAL_MS = 5 * MS_PER_MINUTE
// Absorbs the reconnects every channel makes on its own before anyone is told.
const CHANNEL_DOWN_GRACE_MS = 15 * MS_PER_MINUTE
// One stuck send must not hold the in-flight guard, and with it every later tick.
const CHANNEL_WATCH_SEND_TIMEOUT_MS = MS_PER_MINUTE
const REASON_KEYS: ReadonlyMap<string, MessageKey> = new Map([
  ['auth_failed', 'channel.watchReason.auth_failed'],
  ['not_authenticated', 'channel.watchReason.not_authenticated'],
  ['login_failed', 'channel.watchReason.login_failed'],
  ['duplicate_connection', 'channel.watchReason.duplicate_connection'],
  ['connection_closed', 'channel.watchReason.connection_closed'],
])
const OTHER_REASON_KEY: MessageKey = 'channel.watchReason.other'

interface ChannelWatchInput {
  readonly delivery: DeliveryHub
  readonly locale: Locale
  readonly logger: Logger
  readonly onHealth?: DaemonStartOptions['onHealth']
}

interface DownPeriod {
  readonly downSinceMs: number
  /** The channel the drop was told on, so the return is told there too. */
  toldOn?: ChannelId
  noRouteLogged: boolean
}

/** Channels report status only by merging into their own state, with no bus event, so one small loop
 *  reads the snapshots `/health` already shows. A channel down past the grace is announced once, on
 *  another channel that is up, and once more when it returns. Returns the disposer. */
export function startChannelWatch(input: ChannelWatchInput): () => void {
  const periods = new Map<ChannelId, DownPeriod>()
  const known = { downSet: '' }
  const stop = new AbortController()
  let inFlight: Promise<void> | null = null

  const tick = (): void => {
    if (inFlight !== null) {
      return
    }

    const pass = { input, periods, known, nowMs: performance.now(), signal: stop.signal }

    inFlight = watchOnce(pass).finally(() => {
      inFlight = null
    })
  }
  const timer = setInterval(tick, CHANNEL_WATCH_INTERVAL_MS)

  // Only a tick in flight is worth holding the process open for, and it holds itself.
  timer.unref()

  return () => {
    clearInterval(timer)
    stop.abort()
  }
}

interface WatchPass {
  readonly input: ChannelWatchInput
  readonly periods: Map<ChannelId, DownPeriod>
  readonly known: { downSet: string }
  readonly nowMs: number
  readonly signal: AbortSignal
}

async function watchOnce(pass: WatchPass): Promise<void> {
  const { input, periods } = pass
  const snapshots = input.delivery.snapshots()
  const upChannels = new Set(
    snapshots.filter((snapshot) => toHealthCode(snapshot) === 'ok').map((s) => s.channel)
  )
  const seen = new Set<ChannelId>()

  for (const snapshot of snapshots) {
    seen.add(snapshot.channel)

    if (upChannels.has(snapshot.channel)) {
      await recover(pass, snapshot.channel, upChannels)
    } else {
      await noteDown(pass, snapshot, upChannels)
    }
  }

  // A channel that left the table (stopped for good) has no period to keep.
  for (const channel of periods.keys()) {
    if (!seen.has(channel)) {
      periods.delete(channel)
    }
  }

  reportHealth(pass, snapshots)
}

async function noteDown(
  pass: WatchPass,
  snapshot: ChannelRuntimeSnapshot,
  upChannels: ReadonlySet<ChannelId>
): Promise<void> {
  const { input, periods, nowMs } = pass
  const period: DownPeriod = periods.get(snapshot.channel) ?? {
    downSinceMs: nowMs,
    noRouteLogged: false,
  }

  periods.set(snapshot.channel, period)

  if (period.toldOn !== undefined || nowMs - period.downSinceMs < CHANNEL_DOWN_GRACE_MS) {
    return
  }

  const route = pickRoute(input.delivery, upChannels, { except: snapshot.channel })

  if (route === undefined) {
    if (!period.noRouteLogged) {
      period.noRouteLogged = true
      input.logger.warn('channel.watch_no_route', { channel: snapshot.channel })
    }

    return
  }

  // Before the send: a failed send is not retried, and the next state change has its own message.
  period.toldOn = route.channel
  await sendTo(
    pass,
    route,
    t(input.locale, 'channel.watchDown', {
      channel: snapshot.channel,
      reason: reasonText(input.locale, snapshot),
    })
  )
}

async function recover(
  pass: WatchPass,
  channel: ChannelId,
  upChannels: ReadonlySet<ChannelId>
): Promise<void> {
  const { input, periods } = pass
  const period = periods.get(channel)

  periods.delete(channel)

  if (period?.toldOn === undefined) {
    return
  }

  const route =
    pickRoute(input.delivery, upChannels, { only: period.toldOn }) ??
    pickRoute(input.delivery, upChannels, {})

  if (route !== undefined) {
    await sendTo(pass, route, t(input.locale, 'channel.watchUp', { channel }))
  }
}

/** The first started channel that is up and has a chat of its own, limited to `only`, never
 *  `except`. */
function pickRoute(
  delivery: DeliveryHub,
  upChannels: ReadonlySet<ChannelId>,
  filter: { readonly only?: ChannelId; readonly except?: ChannelId }
): { readonly channel: ChannelId; readonly chatId: string } | undefined {
  for (const [channel, target] of delivery.recipients()) {
    const wanted = filter.only === undefined || channel === filter.only

    if (wanted && channel !== filter.except && upChannels.has(channel)) {
      return target
    }
  }

  return undefined
}

async function sendTo(
  pass: WatchPass,
  target: { readonly channel: ChannelId; readonly chatId: string },
  text: string
): Promise<void> {
  const { input } = pass
  const signal = AbortSignal.any([pass.signal, AbortSignal.timeout(CHANNEL_WATCH_SEND_TIMEOUT_MS)])
  const outcome = await input.delivery
    .sendAcknowledged(target, { text }, { signal })
    .catch((err: unknown) => err)

  if (outcome !== 'accepted') {
    input.logger.warn('channel.watch_send_failed', { channel: target.channel })
  }
}

function reasonText(locale: Locale, snapshot: ChannelRuntimeSnapshot): string {
  return t(locale, reasonKey(snapshot), { brand: BRAND.name })
}

function reasonKey(snapshot: ChannelRuntimeSnapshot): MessageKey {
  return REASON_KEYS.get(snapshot.lastError ?? '') ?? OTHER_REASON_KEY
}

/** `status` reads what a channel is down on from the ready file, so a changed down set is handed to
 *  the daemon, which rewrites it with the boot list. */
function reportHealth(pass: WatchPass, snapshots: readonly ChannelRuntimeSnapshot[]): void {
  const { input, periods, nowMs, known } = pass
  const down = snapshots.filter((snapshot) => {
    const period = periods.get(snapshot.channel)

    return period !== undefined && nowMs - period.downSinceMs >= CHANNEL_DOWN_GRACE_MS
  })
  const key = down.map((snapshot) => `${snapshot.channel}:${snapshot.lastError ?? ''}`).join('|')

  if (key === known.downSet) {
    return
  }

  known.downSet = key
  input.onHealth?.(down.map((snapshot) => toDegradedItem(snapshot)))
}

function toDegradedItem(snapshot: ChannelRuntimeSnapshot): DegradedItem {
  return {
    kind: 'channel',
    subject: snapshot.channel,
    message: {
      key: 'cli.statusChannelDown',
      params: { reason: { key: reasonKey(snapshot), params: { brand: BRAND.name } } },
    },
  }
}
