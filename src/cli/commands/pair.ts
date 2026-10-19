import type { CliApp } from '@/cli/types'
import type { ChannelId } from '@/core/channels'
import { findChannelDefinition } from '@/channels/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagString, type ParsedArgs } from '@/cli/parsing/args'
import { fail, hint, style, success } from '@/cli/ui/colors'
import { availableChannelIds } from '@/cli/ui/format'
import { channelId } from '@/core/channels'
import { t } from '@/i18n'

const CHANNEL_FLAG = {
  type: 'string',
  describe: { key: 'cliHelp.flagRequiredChannelId' },
} as const
const PAIRING_CODE_COMMAND_NEEDS = {
  bootScope: 'persistence',
  startup: 'migrate',
  configFile: 'optional',
} as const

// Tagged union rather than `ChannelId | { error }`: a bare string-literal union on one side breaks the `in` operator's narrowing.
type ChannelResult =
  | { readonly ok: true; readonly channel: ChannelId }
  | { readonly ok: false; readonly error: string }

function resolveChannel(args: ParsedArgs, app: CliApp): ChannelResult {
  const locale = app.config.locale.language
  const raw = flagString(args, 'channel')

  if (raw === undefined) {
    return { ok: false, error: t(locale, 'cli.pairChannelRequired') }
  }

  let channel: ChannelId

  try {
    channel = channelId(raw)
  } catch {
    return { ok: false, error: t(locale, 'cli.pairInvalidChannelId', { id: raw }) }
  }

  const definitions = app.resolve('channels')

  if (findChannelDefinition(definitions, channel) === undefined) {
    return {
      ok: false,
      error: t(locale, 'cli.pairUnknownChannel', {
        id: raw,
        available: availableChannelIds(definitions),
      }),
    }
  }

  return { ok: true, channel }
}

const pairListCommand = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.pairListSummary' },
  spec: { flags: { channel: CHANNEL_FLAG } },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const result = resolveChannel(args, app)

    if (!result.ok) {
      return usage(app, result.error)
    }

    const pending = await app.resolve('pairingStore').listPending(result.channel, Date.now())

    app.out(style.heading(t(locale, 'cli.pairPendingHeading', { count: pending.length })))
    if (pending.length === 0) {
      app.out(hint(t(locale, 'cli.mcpNonePlaceholder')))
    }
    for (const p of pending) {
      app.out(`  ${p.code}  chat=${p.chatId}`)
    }

    return 0
  },
})

const pairApproveCommand = createCommand({
  name: 'approve',
  summary: { key: 'cliHelp.pairApproveSummary' },
  spec: { positional: ['code'] },
  needs: PAIRING_CODE_COMMAND_NEEDS,
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const code = flagString(args, 'code')

    if (code === undefined) {
      return usage(app, t(locale, 'cli.pairApproveUsage'))
    }

    const approval = await app
      .resolve('pairingStore')
      .approve({ code: code.toUpperCase(), now: Date.now() })

    if (!approval.ok) {
      app.err(
        fail(
          approval.reason === 'expired'
            ? t(locale, 'cli.pairCodeExpired', { code })
            : t(locale, 'cli.pairCodeNotFound', { code })
        )
      )

      return 1
    }

    app.out(success(t(locale, 'cli.pairPaired', { chatId: approval.chatId })))

    return 0
  },
})

const pairDenyCommand = createCommand({
  name: 'deny',
  summary: { key: 'cliHelp.pairDenySummary' },
  spec: { positional: ['code'] },
  needs: PAIRING_CODE_COMMAND_NEEDS,
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const code = flagString(args, 'code')

    if (code === undefined) {
      return usage(app, t(locale, 'cli.pairDenyUsage'))
    }

    const denied = await app.resolve('pairingStore').deny({ code: code.toUpperCase() })
    app.out(
      denied
        ? success(t(locale, 'cli.pairDenied', { code }))
        : fail(t(locale, 'cli.pairCodeNotFound', { code }))
    )

    return denied ? 0 : 1
  },
})

const pairRevokeCommand = createCommand({
  name: 'revoke',
  summary: { key: 'cliHelp.pairRevokeSummary' },
  spec: { positional: ['chatId'], flags: { channel: CHANNEL_FLAG } },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const result = resolveChannel(args, app)

    if (!result.ok) {
      return usage(app, result.error)
    }

    const chatId = flagString(args, 'chatId')

    if (chatId === undefined) {
      return usage(app, t(locale, 'cli.pairRevokeUsage'))
    }

    const revoked = await app
      .resolve('pairingStore')
      .revoke({ channel: result.channel, chatId, now: Date.now() })

    app.out(
      revoked
        ? success(t(locale, 'cli.pairRevoked', { chatId }))
        : fail(t(locale, 'cli.pairNotPaired', { chatId }))
    )

    return revoked ? 0 : 1
  },
})

export const pairCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.pair,
  subcommands: [pairListCommand, pairApproveCommand, pairDenyCommand, pairRevokeCommand],
})
