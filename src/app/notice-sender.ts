import type { DeliveryHub } from '@/app/delivery'
import type { ChannelDefinition } from '@/channels/api'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { PairingStore } from '@/core/types/session'
import type { NoticeKind, TradingNotice, TradingNoticeSender } from '@/trading/api'
import { resolveDefaultRecipient } from '@/channels/api'
import { readUpdateLine } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { OperatorConfigError, setEnvCommand } from '@/core/config/resolve'
import { t } from '@/i18n'
import {
  NOTICE_KINDS,
  renderAlertNotice,
  renderBriefText,
  renderCallScoredNotice,
  renderExitFillNotice,
  renderHeldNewsNotice,
  renderIndexDropNotice,
  renderIntradayText,
  renderLoopQuarantineNotice,
  renderRestatementNotice,
  resolveRenderContext,
} from '@/trading/api'

type DeliveryAddress = Parameters<TradingNoticeSender['resolveRecipient']>[0]

/** Readings nobody asked for, one per call, name or session: they reach the bell and a connected
 *  page, and a chat only when `[notices] chat` lists the kind. */
const BELL_ONLY_KINDS = Object.freeze([
  'call-scored',
  'held-news',
  'index-drop',
] as const satisfies readonly NoticeKind[])

/** Unattended delivery has no invoking surface to resolve a context from, and it is only ever sent
 *  to a channel - so it states the destination rather than inventing one to read it from. */
const UNATTENDED_SURFACE = 'channel'

/** The morning brief is often the only thing a channel-only operator reads, so a newer release
 *  rides along at its foot. Every other notice is a signal and stays about the market. */
async function renderWithUpdate(
  notice: TradingNotice,
  config: ResolvedConfig,
  timezone: string
): Promise<string> {
  const text = render(notice, timezone)

  if (notice.payload.kind !== 'brief') {
    return text
  }

  const update = await readUpdateLine(config)

  return update === null ? text : `${text}\n\n${update}`
}

function render(notice: TradingNotice, timezone: string): string {
  const { locale, payload } = notice

  if (
    payload.kind === 'price-alert' ||
    payload.kind === 'exit-alert' ||
    payload.kind === 'screener-alert'
  ) {
    return renderAlertNotice(locale, payload)
  }

  if (payload.kind === 'brief') {
    return renderBrief(locale, payload, timezone)
  }

  if (payload.kind === 'intraday') {
    return renderIntradayText(
      locale,
      payload.report,
      resolveRenderContext(timezone, UNATTENDED_SURFACE)
    )
  }

  if (payload.kind === 'exit-plan' || payload.kind === 'stop-raised') {
    return [t(locale, `trading.notice.${payload.kind}`), ...payload.lines].join('\n')
  }

  if (payload.kind === 'exit-filled') {
    return renderExitFillNotice(locale, payload)
  }

  if (isBellOnlyPayload(payload)) {
    return renderBellOnlyNotice(locale, payload)
  }

  return renderOperationalNotice(locale, payload)
}

function renderBrief(
  locale: Locale,
  payload: Extract<TradingNotice['payload'], { readonly kind: 'brief' }>,
  timezone: string
): string {
  const body = renderBriefText(
    locale,
    payload.snapshot,
    resolveRenderContext(timezone, UNATTENDED_SURFACE)
  )

  return payload.sentAfterOpen === true
    ? `${t(locale, 'trading.brief.sentAfterOpen')}\n\n${body}`
    : body
}

/** The bell-only readings: a scored call, news on a holding, the index falling. */
type BellOnlyKind = (typeof BELL_ONLY_KINDS)[number]

type BellOnlyPayload = Extract<TradingNotice['payload'], { readonly kind: BellOnlyKind }>

function isBellOnlyPayload(payload: TradingNotice['payload']): payload is BellOnlyPayload {
  return isBellOnlyKind(payload.kind)
}

function renderBellOnlyNotice(locale: Locale, payload: BellOnlyPayload): string {
  if (payload.kind === 'call-scored') {
    return renderCallScoredNotice(locale, payload)
  }

  return payload.kind === 'held-news'
    ? renderHeldNewsNotice(locale, payload)
    : renderIndexDropNotice(locale, payload)
}

/** The notices about the service itself rather than a reading of the market. */
type OperationalPayload = Exclude<
  TradingNotice['payload'],
  {
    readonly kind:
      | 'price-alert'
      | 'exit-alert'
      | 'screener-alert'
      | 'brief'
      | 'intraday'
      | 'exit-plan'
      | 'stop-raised'
      | 'exit-filled'
      | BellOnlyKind
  }
>

function renderOperationalNotice(locale: Locale, payload: OperationalPayload): string {
  if (payload.kind === 'series-restated') {
    return renderRestatementNotice(locale, payload.tickers)
  }

  if (payload.kind === 'loop-quarantined') {
    return renderLoopQuarantineNotice(locale, payload.operation, payload.retryInMs)
  }

  if (payload.kind === 'delivery-skipped') {
    return renderDeliveryReport(locale, 'trading.deliverySkipped', payload.subject)
  }

  if (payload.kind === 'delivery-missed') {
    return renderDeliveryReport(locale, 'trading.deliveryMissed', payload.subject)
  }

  if (payload.kind === 'key-missing') {
    return renderKeyMissing(locale, payload)
  }

  // Exhaustive: a new kind must be rendered here, not fall through to "delivery is now off".
  if (payload.kind === 'delivery-disabled') {
    return renderDeliveryReport(locale, 'trading.deliveryDisabled', payload.subject)
  }

  const unhandled: never = payload

  return unhandled
}

type DeliveryReportKey =
  | 'trading.deliveryMissed'
  | 'trading.deliveryDisabled'
  | 'trading.deliverySkipped'

function renderDeliveryReport(locale: Locale, key: DeliveryReportKey, subject: NoticeKind): string {
  return t(locale, key, { subject: t(locale, `trading.notice.${subject}`) })
}

function renderKeyMissing(
  locale: Locale,
  payload: { readonly subject: NoticeKind; readonly env: string }
): string {
  return t(locale, 'trading.deliveryKeyMissing', {
    subject: t(locale, `trading.notice.${payload.subject}`),
    env: payload.env,
    command: setEnvCommand(payload.env),
    brand: BRAND.name,
  })
}

// Only a reading the operator may reply to is labelled; a delivery report is not one.
function noticeLabelOf(notice: TradingNotice): { readonly noticeLabel?: string } {
  const { kind } = notice.payload

  return isNoticeKind(kind) ? { noticeLabel: t(notice.locale, `trading.notice.${kind}`) } : {}
}

function isNoticeKind(kind: string): kind is NoticeKind {
  return NOTICE_KINDS.some((known) => known === kind)
}

function isBellOnlyKind(kind: string): boolean {
  return BELL_ONLY_KINDS.some((known) => known === kind)
}

/** A bell-only kind stays off the chats unless the operator named it. */
function isBellOnly(kind: string, chatKinds: readonly string[]): boolean {
  return isBellOnlyKind(kind) && !chatKinds.includes(kind)
}

/** `[notices] chat` may name only the kinds the daemon holds back from a chat. Core takes the
 *  strings as written, so this is where an unknown one is refused. */
export function assertNoticeChatKinds(chat: readonly string[]): void {
  const kinds = BELL_ONLY_KINDS.join(', ')

  for (const kind of chat) {
    if (!isBellOnlyKind(kind)) {
      throw new OperatorConfigError(
        `[notices] chat names an unknown notice kind: ${kind}`,
        { key: 'errors.noticeKindUnknown', params: { kind, kinds } },
        { path: ['notices', 'chat'] }
      )
    }
  }
}

interface NoticeSenderOptions {
  readonly delivery: DeliveryHub
  readonly config: ResolvedConfig
  readonly timezone: string
  /** A thunk: the sender is built while the providers are assembled, before the container can
   *  answer for the registered channel definitions. */
  readonly channels: () => readonly ChannelDefinition[]
  readonly pairingStore: () => PairingStore
}

/** The one adapter between trading's typed notices and the channel layer. Trading imports no
 *  channel code and renders no text; `app` owns both, and `accepted` here means the channel's own
 *  sender call completed — never that the notice was queued. */
export function createTradingNoticeSender(options: NoticeSenderOptions): TradingNoticeSender {
  const { delivery, config, timezone } = options

  return {
    send: async (notice, signal) => {
      const text = await renderWithUpdate(notice, config, timezone)

      if (isBellOnly(notice.payload.kind, config.notices.chat)) {
        return delivery.post({ text, notice })
      }

      return await delivery.sendAcknowledged(
        notice.target,
        { text, notice },
        { ...(signal === undefined ? {} : { signal }), ...noticeLabelOf(notice) }
      )
    },
    // The attached channel runtimes plus the attached notice surfaces are the whole routing table:
    // `cli` is a surface a person types at, never one the daemon can push to, so it resolves to the
    // chat the daemon would use.
    resolveRecipient: async (origin) => {
      if (await delivery.isDeliverable(origin)) {
        return origin
      }

      return origin.channel === LOCAL_CHANNEL_ID ? await resolveLocalRecipient(options) : undefined
    },
  }
}

// In the daemon the live default recipient, unless its pairing was revoked since it was last read;
// in a terminal process, whichever configured or paired chat the daemon would pick - the alert or
// brief waits in the book until the daemon runs.
async function resolveLocalRecipient(
  options: NoticeSenderOptions
): Promise<DeliveryAddress | undefined> {
  const { delivery, config } = options

  if (!delivery.attached()) {
    return await resolveDefaultRecipient(
      options.channels(),
      config.channels,
      options.pairingStore()
    )
  }

  const target = delivery.defaultRecipient()

  return target !== undefined && (await delivery.isDeliverable(target)) ? target : undefined
}
