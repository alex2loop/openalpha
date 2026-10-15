import type { Affordance, SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { SocialService } from '@/social/service'
import { operatorMessageOf } from '@/core/errors'
import { bindLocale, t } from '@/i18n'
import { type DraftRender, renderApproveOutcome, renderDraftView } from '@/social/draft-view'

const MESSAGE_KEYS = ['slash.socialUsage'] as const
const READ_POLICY = {
  surfaces: ['channel', 'repl'] as const,
  role: 'operator' as const,
  action: 'read' as const,
}
const MUTATE_POLICY = {
  ...READ_POLICY,
  action: 'mutate' as const,
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
}
const SUBCOMMANDS = ['drafts', 'approve', 'discard'] as const

/** `/social drafts`, `/social approve <id>`, `/social discard <id>`: the operator's drafts from any
 *  chat. Operator role only; an approval re-runs every check, as the CLI does. */
export function createSocialSlashCommand(service: () => SocialService): SlashCommand {
  return {
    name: 'social',
    description: { kind: 'localized', key: 'slash.socialHelp' },
    messageKeys: [...MESSAGE_KEYS],
    policy: READ_POLICY,
    policyFor: (args) => (args[0] === 'drafts' || args.length === 0 ? READ_POLICY : MUTATE_POLICY),
    completeFor: (args) => (args.length === 1 ? [...SUBCOMMANDS] : []),
    run: (ctx) => runSocialSlash(service(), ctx),
  }
}

async function runSocialSlash(service: SocialService, ctx: SlashContext): Promise<SlashResult> {
  const [action, id] = ctx.args

  try {
    if (action === undefined || action === 'drafts') {
      return await listResult(service, ctx)
    }

    if (id === undefined || (action !== 'approve' && action !== 'discard')) {
      return usage()
    }

    return action === 'approve'
      ? await approveResult(service, ctx, id)
      : await discardResult(service, ctx, id)
  } catch (err: unknown) {
    const operator = operatorMessageOf(err)

    // An unknown or expired id reads in the operator's language; anything else is the dispatcher's.
    if (operator === undefined) {
      throw err
    }

    return { kind: 'text', text: bindLocale(ctx.locale).translate(operator.key, operator.params) }
  }
}

function chatRender(ctx: SlashContext): DraftRender {
  return { locale: ctx.locale, fenced: true }
}

function usage(): SlashResult {
  return { kind: 'message', messages: [{ key: 'slash.socialUsage' }] }
}

async function listResult(service: SocialService, ctx: SlashContext): Promise<SlashResult> {
  const drafts = await service.listDrafts()

  if (drafts.length === 0) {
    return { kind: 'text', text: t(ctx.locale, 'social.noDrafts') }
  }

  const affordances: Affordance[] = drafts.flatMap((draft) => [
    {
      label: t(ctx.locale, 'social.approveButton', { id: draft.id }),
      command: `/social approve ${draft.id}`,
    },
    {
      label: t(ctx.locale, 'social.discardButton', { id: draft.id }),
      command: `/social discard ${draft.id}`,
    },
  ])

  return {
    kind: 'text',
    text: drafts.map((draft) => renderDraftView(chatRender(ctx), draft).join('\n')).join('\n\n'),
    affordances,
  }
}

// The chat already showed the draft through `/social drafts`, and the tap or the typed command is
// the confirmation.
async function approveResult(
  service: SocialService,
  ctx: SlashContext,
  id: string
): Promise<SlashResult> {
  const outcome = await service.approveDraft(id, ctx.signal)

  return { kind: 'text', text: renderApproveOutcome(chatRender(ctx), id, outcome).lines.join('\n') }
}

async function discardResult(
  service: SocialService,
  ctx: SlashContext,
  id: string
): Promise<SlashResult> {
  await service.discardDraft(id)

  return { kind: 'text', text: t(ctx.locale, 'social.discarded', { id }) }
}
