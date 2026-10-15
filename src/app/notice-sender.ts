import type { DeliveryHub } from '@/app/services'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { NoticeKind, TradingNotice, TradingNoticeSender } from '@/trading/api'
import { readUpdateLine } from '@/cli/api'
import { t } from '@/i18n'
import {
  renderAlertNotice,
  renderBriefText,
  renderIntradayText,
  renderLoopQuarantineNotice,
  renderRestatementNotice,
  resolveRenderContext,
} from '@/trading/api'

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
    return renderBriefText(
      locale,
      payload.snapshot,
      resolveRenderContext(timezone, UNATTENDED_SURFACE)
    )
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

  return renderDeliveryDisabled(locale, payload.subject)
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

/** The one adapter between trading's typed notices and the channel layer. Trading imports no
 *  channel code and renders no text; `app` owns both, and `accepted` here means the channel's own
 *  sender call completed — never that the notice was queued. */
export function createTradingNoticeSender(
  delivery: DeliveryHub,
  config: ResolvedConfig,
  timezone: string
): TradingNoticeSender {
  return {
    send: async (notice, signal) => {
      const text = await renderWithUpdate(notice, config, timezone)

      return await delivery.sendAcknowledged(notice.target, { text, notice }, signal)
    },
    // The attached channel runtimes plus the attached notice surfaces are the whole routing table:
    // `cli` is a surface a person types at, never one the daemon can push to.
    canDeliver: (target) =>
      delivery.surfaces.find(target.channel) !== undefined ||
      delivery.snapshots().some((snapshot) => snapshot.channel === target.channel),
  }
}
