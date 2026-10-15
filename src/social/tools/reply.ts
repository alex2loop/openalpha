import type { ToolResult } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { SocialReply } from '@/social/request/outcome'
import { type MessageKey, t } from '@/i18n'
import { DRAFT_REASON_KEYS } from '@/social/notices'

type Refusal = Extract<SocialReply, { kind: 'refused' }>['refusal']

const REFUSAL_KEYS: Readonly<Record<Refusal, MessageKey>> = Object.freeze({
  'agent-unavailable': 'toolErrors.socialAgentUnavailable',
  'no-focus': 'toolErrors.socialNoFocus',
  'tools-changed': 'toolErrors.socialToolsChanged',
  'not-member': 'toolErrors.socialNotMember',
  'network-paused': 'toolErrors.socialNetworkPaused',
  'member-paused': 'toolErrors.socialMemberPaused',
  'pin-mismatch': 'toolErrors.socialPinMismatch',
  'no-key': 'toolErrors.socialNoKey',
  'bad-path': 'toolErrors.socialBadPath',
  'method-override': 'toolErrors.socialMethodOverride',
  'unknown-endpoint': 'toolErrors.socialUnknownEndpoint',
  unlabelled: 'toolErrors.socialUnlabelled',
  blocked: 'toolErrors.socialBlocked',
  secret: 'toolErrors.socialSecret',
  'own-key': 'toolErrors.socialOwnKey',
  cooldown: 'toolErrors.socialCooldown',
  'daily-cap': 'toolErrors.socialDailyCap',
  'read-rate': 'toolErrors.socialReadRate',
  duplicate: 'toolErrors.socialDuplicate',
  'drafts-full': 'toolErrors.socialDraftsFull',
  'unknown-file': 'toolErrors.socialUnknownFile',
  drafted: 'toolErrors.socialDrafted',
})

/** One reply shape for both tools. The executor's output pipeline wraps `text` as untrusted data,
 *  so it is never wrapped here. */
export function renderSocialReply(locale: Locale, reply: SocialReply): ToolResult {
  if (reply.kind === 'text') {
    return { content: reply.text, isError: false }
  }

  return {
    content: t(locale, REFUSAL_KEYS[reply.refusal], toLocalizedParams(locale, reply.params)),
    isError: reply.refusal !== 'drafted',
  }
}

/** A draft's `reason` travels as its stored word (`outside-link`); the model reads it in words. */
function toLocalizedParams(
  locale: Locale,
  params: Readonly<Record<string, string | number>> | undefined
): Readonly<Record<string, string | number>> | undefined {
  const reason = params?.reason
  const key = Object.entries(DRAFT_REASON_KEYS).find(([name]) => name === reason)?.[1]

  return key === undefined ? params : { ...params, reason: t(locale, key) }
}
