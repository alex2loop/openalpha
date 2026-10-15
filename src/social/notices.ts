import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SocialDraftReason } from '@/core/types/social'
import type { MessageKey } from '@/i18n'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

type SocialNotice =
  | {
      readonly kind: 'skill-changed'
      readonly network: string
      readonly files: number
      readonly endpoints: number
    }
  | { readonly kind: 'pin-mismatch'; readonly network: string }
  | { readonly kind: 'key-refused'; readonly agentId: string; readonly network: string }
  | { readonly kind: 'member-paused'; readonly agentId: string; readonly network: string }
  | {
      readonly kind: 'draft-waiting'
      readonly agentId: string
      readonly network: string
      readonly draftId: string
      readonly reason: SocialDraftReason
    }

/** Where a notice goes. `app` binds it to the delivery hub's default recipient. */
export interface SocialNotifier {
  notify(notice: SocialNotice): Promise<void>
}

export const DRAFT_REASON_KEYS: Readonly<Record<SocialDraftReason, MessageKey>> = {
  dm: 'social.draftReasonDm',
  delete: 'social.draftReasonDelete',
  'outside-link': 'social.draftReasonLink',
  'review-all': 'social.draftReasonReview',
}

export function renderSocialNotice(locale: Locale, notice: SocialNotice): string {
  const brand = BRAND.name

  switch (notice.kind) {
    case 'skill-changed':
      return t(locale, 'social.noticeSkillChanged', {
        network: notice.network,
        files: notice.files,
        endpoints: notice.endpoints,
        brand,
      })
    case 'pin-mismatch':
      return t(locale, 'social.noticePinMismatch', { network: notice.network, brand })
    case 'key-refused':
      return t(locale, 'social.noticeKeyRefused', {
        agent: notice.agentId,
        network: notice.network,
        brand,
      })
    case 'member-paused':
      return t(locale, 'social.noticeMemberPaused', {
        agent: notice.agentId,
        network: notice.network,
        brand,
      })
    case 'draft-waiting':
      return t(locale, 'social.noticeDraftWaiting', {
        agent: notice.agentId,
        network: notice.network,
        id: notice.draftId,
        reason: t(locale, DRAFT_REASON_KEYS[notice.reason]),
        brand,
      })
    default: {
      const exhaustive: never = notice

      return exhaustive
    }
  }
}

/** A notice that cannot be sent is logged and never fails what triggered it. */
export async function notifySafely(
  notifier: SocialNotifier,
  logger: Logger,
  notice: SocialNotice
): Promise<void> {
  try {
    await notifier.notify(notice)
  } catch (err: unknown) {
    logger.warn('social.notice_failed', { kind: notice.kind, err: formatErrForLog(err) })
  }
}
