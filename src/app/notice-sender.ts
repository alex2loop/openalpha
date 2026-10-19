import type { DeliveryHub } from '@/app/delivery'
import type { ChannelDefinition } from '@/channels/api'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { NoticeKind, TradingNotice, TradingNoticeSender } from '@/trading/api'
import { resolveConfiguredRecipient } from '@/channels/api'
import { readUpdateLine } from '@/cli/api'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { setEnvCommand } from '@/core/config/resolve'
import { t } from '@/i18n'
import {
  NOTICE_KINDS,
  renderAlertNotice,
  renderBriefText,
  renderIntradayText,
  renderLoopQuarantineNotice,
  renderRestatementNotice,
  resolveRenderContext,
} from '@/trading/api'

type DeliveryAddress = Parameters<TradingNoticeSender['resolveRecipient']>[0]

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
    const body = renderBriefText(
      locale,
      payload.snapshot,
      resolveRenderContext(timezone, UNATTENDED_SURFACE)
    )

    return payload.sentAfterOpen === true
      ? `${t(locale, 'trading.brief.sentAfterOpen')}\n\n${body}`
      : body
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

  if (payload.kind === 'series-restated') {
    return renderRestatementNotice(locale, payload.tickers)
  }

  if (payload.kind === 'loop-quarantined') {
    return renderLoopQuarantineNotice(locale, payload.operation, payload.retryInMs)
  }

  if (payload.kind === 'delivery-skipped') {
    return renderDeliverySkipped(locale, payload.subject)
  }

  if (payload.kind === 'delivery-missed') {
    return renderDeliveryMissed(locale, payload.subject)
  }

  if (payload.kind === 'key-missing') {
    return renderKeyMissing(locale, payload)
  }

  // Exhaustive: a new kind must be rendered here, not fall through to "delivery is now off".
  if (payload.kind === 'delivery-disabled') {
    return renderDeliveryDisabled(locale, payload.subject)
  }

  const unhandled: never = payload

  return unhandled
}

function renderDeliveryMissed(locale: Locale, subject: NoticeKind): string {
  return t(locale, 'trading.deliveryMissed', { subject: t(locale, `trading.notice.${subject}`) })
}

function renderDeliveryDisabled(locale: Locale, subject: NoticeKind): string {
  return t(locale, 'trading.deliveryDisabled', {
    subject: t(locale, `trading.notice.${subject}`),
  })
}

function renderDeliverySkipped(locale: Locale, subject: NoticeKind): string {
  return t(locale, 'trading.deliverySkipped', {
    subject: t(locale, `trading.notice.${subject}`),
  })
}

function renderKeyMissing(
  locale: Locale,
  payload: { readonly subject: NoticeKind; readonly env: string }
): string {
  return t(locale, 'trading.deliveryKeyMissing', {
    subject: t(locale, `trading.notice.${payload.subject}`),
    env: payload.env,
    command: setEnvCommand(payload.env),
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

interface NoticeSenderOptions {
  readonly delivery: DeliveryHub
  readonly config: ResolvedConfig
  readonly timezone: string
  /** A thunk: the sender is built while the providers are assembled, before the container can
   *  answer for the registered channel definitions. */
  readonly channels: () => readonly ChannelDefinition[]
}

/** The one adapter between trading's typed notices and the channel layer. Trading imports no
 *  channel code and renders no text; `app` owns both, and `accepted` here means the channel's own
 *  sender call completed — never that the notice was queued. */
export function createTradingNoticeSender(options: NoticeSenderOptions): TradingNoticeSender {
  const { delivery, config, timezone } = options

  return {
    send: async (notice, signal) => {
      const text = await renderWithUpdate(notice, config, timezone)

      return await delivery.sendAcknowledged(
        notice.target,
        { text, notice },
        { ...(signal === undefined ? {} : { signal }), ...noticeLabelOf(notice) }
      )
    },
    // The attached channel runtimes plus the attached notice surfaces are the whole routing table:
    // `cli` is a surface a person types at, never one the daemon can push to, so it resolves to the
    // chat the daemon would use.
    resolveRecipient: (origin) => {
      if (isRoutable(delivery, origin)) {
        return origin
      }

      return origin.channel === LOCAL_CHANNEL_ID ? resolveLocalRecipient(options) : undefined
    },
  }
}

function isRoutable(delivery: DeliveryHub, target: DeliveryAddress): boolean {
  return (
    delivery.surfaces.find(target.channel) !== undefined ||
    delivery.snapshots().some((snapshot) => snapshot.channel === target.channel)
  )
}

// In the daemon the live default recipient; in a terminal process, whichever configured channel the
// daemon would pick - the alert or brief waits in the book until the daemon runs.
function resolveLocalRecipient(options: NoticeSenderOptions): DeliveryAddress | undefined {
  const { delivery, config } = options

  return delivery.attached()
    ? delivery.defaultRecipient()
    : resolveConfiguredRecipient(options.channels(), config.channels)
}
