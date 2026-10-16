import type { Locale } from '@/core/types/locale'
import type { ApproveOutcome, SocialDraftView } from '@/social/drafts'
import { sanitizeDisplayText, toFencedText, toSingleLine } from '@/core/utils/text'
import { dayInZone } from '@/core/utils/time'
import { formatDay, t } from '@/i18n'
import { DRAFT_REASON_KEYS } from '@/social/notices'
import { maybeLiveLines, renderSocialReply } from '@/social/tools/reply'

/** The network's own answer, cut so one reply cannot flood a chat. */
const ANSWER_SHOWN_CHARS = 2_000
const INDENT = '  '

export interface DraftRender {
  readonly locale: Locale
  /** `[locale] timezone`, the day a draft's date is read on. */
  readonly timeZone: string
  /** A chat renders markdown: what the network or the agent wrote goes inside a code block, so a
   *  link or bold in it shows as the characters that will be sent. */
  readonly fenced?: boolean
}

interface RenderedOutcome {
  /** False when nothing was published; the surface marks the first line as a failure. */
  readonly ok: boolean
  readonly lines: readonly string[]
}

/** A draft as the operator reads it before approving: what it is, the full text it will send,
 *  and why it waits. No value from the network or the agent keeps a control character. */
export function renderDraftView(render: DraftRender, view: SocialDraftView): readonly string[] {
  const { locale } = render

  return [
    t(locale, 'social.draftTitle', {
      id: view.id,
      agent: view.agentId,
      network: view.network,
      day: formatDay(locale, dayInZone(view.createdAt, render.timeZone)),
    }),
    `${INDENT}${t(locale, 'social.draftTarget', {
      method: view.method,
      path: view.path,
      reason: t(locale, DRAFT_REASON_KEYS[view.reason]),
    })}`,
    ...untrustedBlock(render, [
      // One line per pair: a newline in a value must not start a line that looks like ours.
      ...Object.entries(view.query ?? {}).map(
        ([key, value]) => `${INDENT}${toSingleLine(key)}=${toSingleLine(value)}`
      ),
      ...view.body.split('\n').map((line) => `${INDENT}${line}`),
    ]),
    ...(view.bodyCut ? [t(locale, 'social.draftCut')] : []),
    ...(view.links.length > 0
      ? [t(locale, 'social.draftLinks', { hosts: view.links.join(', ') })]
      : []),
    ...(view.madeUnderOlderSkill
      ? [t(locale, 'social.draftOlderSkill', { network: view.network })]
      : []),
  ]
}

export function renderApproveOutcome(
  render: DraftRender,
  id: string,
  outcome: ApproveOutcome
): RenderedOutcome {
  const { locale } = render

  if (outcome.kind === 'refused') {
    const reason = renderSocialReply(locale, outcome.reply).content

    return { ok: false, lines: [t(locale, 'social.approveRefused', { id, reason })] }
  }

  if (outcome.kind === 'failed' && maybeLiveLines(locale, outcome.reply).length > 0) {
    return {
      ok: false,
      lines: [t(locale, 'social.approveMaybeLive', { id }), ...answerLines(render, outcome.reply)],
    }
  }

  if (outcome.kind === 'failed') {
    return {
      ok: false,
      lines: [t(locale, 'social.approveFailed', { id }), ...answerLines(render, outcome.reply)],
    }
  }

  return {
    ok: true,
    lines: [
      t(locale, 'social.draftSent', { id, status: outcome.reply.status ?? '' }),
      ...answerLines(render, outcome.reply),
      ...(outcome.needsVerification ? [t(locale, 'social.needsVerification')] : []),
    ],
  }
}

function answerLines(render: DraftRender, reply: ApproveOutcome['reply']): readonly string[] {
  // The network's own words reach a terminal and a chat: no escape sequences or control characters.
  return reply.kind === 'text'
    ? untrustedBlock(render, [sanitizeDisplayText(reply.text).slice(0, ANSWER_SHOWN_CHARS)])
    : []
}

function untrustedBlock(render: DraftRender, lines: readonly string[]): readonly string[] {
  return render.fenced === true ? toFencedText(lines.join('\n')).split('\n') : lines
}
