import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Command, Group } from '@/cli/command'
import type { ParsedArgs, Spec } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { ChannelId } from '@/core/channels'
import type { AgentId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import { findChannelDefinition } from '@/channels/api'
import { createCommand, createGroup } from '@/cli/command'
import { agentCmdPause, agentCmdResume } from '@/cli/commands/agent-pause'
import { agentExtraLines } from '@/cli/commands/agent-record'
import { isEditorSet, openInEditor } from '@/cli/editor'
import { editorFromEnv } from '@/cli/env'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { hint, style, success } from '@/cli/ui/colors'
import { availableChannelIds } from '@/cli/ui/format'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { channelId } from '@/core/channels'
import { agentId, LOCAL_USER_ID } from '@/core/ids'
import { createPrivateFileAtomic } from '@/core/security/private-files'
import { sanitizeDisplayText, toSingleLine } from '@/core/utils/text'
import {
  assertValidAgentToml,
  isValidAgentId,
  RESERVED_AGENT_IDS,
  userAgentFile,
} from '@/engine/api'
import { t } from '@/i18n'

const CHANNEL_FLAG = {
  type: 'string',
  describe: { key: 'cliHelp.flagChannelId' },
} satisfies NonNullable<Spec['flags']>[string]

interface ChatTarget {
  readonly channel: ChannelId
  readonly chatId: string
}

interface Ok<T> {
  readonly kind: 'value'
  readonly value: T
}

interface Err {
  readonly kind: 'error'
  readonly error: string
}

type OrError<T> = Ok<T> | Err

const agentCmdList: Command = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.agentListSummary' },
  run: listAgents,
})

const agentCmdShow: Command = createCommand({
  name: 'show',
  summary: { key: 'cliHelp.agentShowSummary' },
  spec: { positional: ['id'] },
  run: showAgent,
})

const agentCmdBind: Command = createCommand({
  name: 'bind',
  summary: { key: 'cliHelp.agentBindSummary' },
  spec: {
    positional: ['chatId', 'agentId'],
    flags: { channel: CHANNEL_FLAG },
  },
  run: bindChat,
})

const agentCmdUnbind: Command = createCommand({
  name: 'unbind',
  summary: { key: 'cliHelp.agentUnbindSummary' },
  spec: {
    positional: ['chatId'],
    flags: { channel: CHANNEL_FLAG },
  },
  run: unbindChat,
})

const agentCmdBindings: Command = createCommand({
  name: 'bindings',
  summary: { key: 'cliHelp.agentBindingsSummary' },
  run: listBindings,
})

const agentCmdAdd: Command = createCommand({
  name: 'add',
  summary: { key: 'cliHelp.agentAddSummary' },
  spec: { positional: ['id'] },
  run: addAgent,
})

const agentCmdEdit: Command = createCommand({
  name: 'edit',
  summary: { key: 'cliHelp.agentEditSummary' },
  spec: { positional: ['id'] },
  run: editAgent,
})

const agentCmdRemove: Command = createCommand({
  name: 'remove',
  summary: { key: 'cliHelp.agentRemoveSummary' },
  spec: {
    positional: ['id'],
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  run: removeAgent,
})

export const agentCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.agent,
  subcommands: [
    agentCmdList,
    agentCmdShow,
    agentCmdAdd,
    agentCmdEdit,
    agentCmdRemove,
    agentCmdPause,
    agentCmdResume,
    agentCmdBind,
    agentCmdUnbind,
    agentCmdBindings,
  ],
})

function parseMutableAgentId(
  args: ParsedArgs,
  app: CliApp,
  usageText: string
): AgentId | undefined {
  const raw = flagString(args, 'id')

  if (raw === undefined || !isValidAgentId(raw)) {
    usage(app, usageText)
    return undefined
  }

  if (RESERVED_AGENT_IDS.has(raw)) {
    usage(app, t(app.config.locale.language, 'cli.agentReservedId', { id: raw }))
    return undefined
  }

  return agentId(raw)
}

// Checked against the loaded registry, not just the file tree: a built-in id is taken even though
// nothing sits at its path, and buildUserAgents skips a colliding file rather than shadowing the
// shipped agent — so the file would land and silently do nothing.
async function addAgent(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const id = parseMutableAgentId(args, app, t(locale, 'cli.agentAddUsage'))

  if (id === undefined) {
    return 2
  }

  if (app.resolve('agents').has(id)) {
    return usage(app, t(locale, 'cli.agentAlreadyTaken', { id }))
  }

  const path = userAgentFile(app.config.paths.dataDir, id)

  if (await Bun.file(path).exists()) {
    return usage(app, t(locale, 'cli.agentAlreadyExists', { id, path }))
  }

  await createPrivateFileAtomic({
    path,
    content: agentTemplate(id),
    validate: (content) => {
      assertValidAgentToml(content, id)
    },
  })
  app.out(success(t(locale, 'cli.agentCreated', { path })))

  return 0
}

function agentTemplate(id: string): string {
  return [
    `name = "${id}"`,
    'system_prompt = """',
    `You are ${id}.`,
    '"""',
    '',
    "# max_daily_usd = 0.5       # this agent's share of the day",
    '',
    '# [focus]                   # leave out to share your own focus',
    '# markets = ["equity-vn"]',
    '# horizon = "long"',
    '',
    '[capabilities]',
    '# Nothing is granted until it is named here. Use "*" for every registered tool.',
    'tools = []',
    '',
  ].join('\n')
}

// No editor fallback here, unlike `config edit`: an agent file opened in an editor the operator did
// not choose is worse than being told to set $EDITOR.
async function editAgent(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const id = parseMutableAgentId(args, app, t(locale, 'cli.agentEditUsage'))

  if (id === undefined) {
    return 2
  }

  const path = userAgentFile(app.config.paths.dataDir, id)

  if (!(await Bun.file(path).exists())) {
    return usage(app, t(locale, 'cli.agentNoUserAgentFile', { id }))
  }

  const editor = editorFromEnv()

  if (!isEditorSet(editor)) {
    return usage(app, t(locale, 'cli.agentEditorNotSet'))
  }

  return openInEditor(editor, path, app)
}

async function removeAgent(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const id = parseMutableAgentId(args, app, t(locale, 'cli.agentRemoveUsage'))

  if (id === undefined) {
    return 2
  }

  const path = userAgentFile(app.config.paths.dataDir, id)

  if (!(await Bun.file(path).exists())) {
    return usage(app, t(locale, 'cli.agentCannotRemoveBuiltin', { id }))
  }

  if (await app.resolve('socialService').isMember(id)) {
    return usage(app, t(locale, 'cli.agentOnSocial', { agent: id, brand: BRAND.name }))
  }

  const dir = dirname(path)

  if (
    !(
      flagBool(args, 'yes') ||
      (await confirm(defaultPrompt(), t(locale, 'cli.agentDeleteConfirm', { path: dir }), locale))
    )
  ) {
    return declined(app)
  }

  // Cleared first: a failure here surfaces before anything is deleted, and a later agent reusing
  // the id is never born paused.
  await app.resolve('agentPauseStore').resume([id])
  await rm(dir, { recursive: true, force: true })
  app.out(success(t(locale, 'cli.agentRemoved', { path: dir })))

  return 0
}

async function listAgents(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const agents = [...app.resolve('agents').values()].sort((a, b) => a.id.localeCompare(b.id))
  const paused = await app.resolve('agentPauseStore').list()

  if (agents.length === 0) {
    app.out(hint(t(locale, 'cli.agentNoAgents')))
    return 0
  }

  const extra = await agentExtraLines(app, agents)

  for (const agent of agents) {
    app.out(
      `${style.heading(agent.id)}  ${hint(displayText(agent.model))}${pausedMark(locale, paused, agent.id)}`
    )

    for (const line of extra.get(agent.id) ?? []) {
      app.out(hint(`  ${line}`))
    }
  }

  return 0
}

// Agent TOML is untrusted (user and plugin files): its free text reaches the terminal only after
// control characters and escapes are gone, and one value never spans lines.
function displayText(value: string): string {
  return toSingleLine(sanitizeDisplayText(value))
}

function pausedMark(locale: Locale, paused: ReadonlySet<AgentId>, id: AgentId): string {
  return paused.has(id) ? `  ${style.warn(t(locale, 'cli.agentPausedMark'))}` : ''
}

async function showAgent(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const id = flagString(args, 'id')

  if (id === undefined) {
    return usage(app, t(locale, 'cli.agentShowRequiresId'))
  }

  const agent = app.resolve('agents').get(id)

  if (agent === undefined) {
    return usage(app, t(locale, 'cli.agentUnknown', { id }))
  }

  const paused = await app.resolve('agentPauseStore').list()

  const none = t(locale, 'cli.mcpNonePlaceholder')

  app.out(
    `${style.heading(agent.id)}  ${hint(displayText(agent.model))}${pausedMark(locale, paused, agent.id)}`
  )
  app.out(`  ${displayText(agent.description ?? t(locale, 'cli.agentNoDescription'))}`)
  app.out(`  ${t(locale, 'cli.agentFieldTools')}: ${displayText(agent.tools.join(', ')) || none}`)
  app.out(
    `  ${t(locale, 'cli.agentFieldDelegates')}: ${displayText(agent.delegates.join(', ')) || none}`
  )
  app.out(`  ${t(locale, 'cli.agentFieldMaxTurns')}: ${agent.maxTurns}`)

  for (const line of (await agentExtraLines(app, [agent])).get(agent.id) ?? []) {
    app.out(`  ${line}`)
  }

  return 0
}

// Shared by bind/unbind/bindings: all three need a validated channel + chatId pair.
function requireChannel(args: ParsedArgs, app: CliApp): OrError<{ readonly channel: ChannelId }> {
  const locale = app.config.locale.language
  const raw = flagString(args, 'channel')

  if (raw === undefined) {
    return { kind: 'error', error: t(locale, 'cli.agentRequiresChannel') }
  }

  let channel: ChannelId

  try {
    channel = channelId(raw)
  } catch {
    return { kind: 'error', error: t(locale, 'cli.agentInvalidChannelId', { id: raw }) }
  }

  const definitions = app.resolve('channels')

  if (findChannelDefinition(definitions, channel) === undefined) {
    return {
      kind: 'error',
      error: t(locale, 'cli.agentUnknownChannel', {
        id: raw,
        available: availableChannelIds(definitions),
      }),
    }
  }

  return { kind: 'value', value: { channel } }
}

function requireChatTarget(args: ParsedArgs, app: CliApp): OrError<ChatTarget> {
  const locale = app.config.locale.language
  const chatId = flagString(args, 'chatId')
  const channel = requireChannel(args, app)

  if (chatId === undefined) {
    return { kind: 'error', error: t(locale, 'cli.agentRequiresChatId') }
  }

  if (channel.kind === 'error') {
    return channel
  }

  return { kind: 'value', value: { channel: channel.value.channel, chatId } }
}

async function bindChat(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const target = requireChatTarget(args, app)

  if (target.kind === 'error') {
    return usage(app, `agent bind ${target.error}`)
  }

  const { channel, chatId } = target.value

  const rawAgentId = flagString(args, 'agentId')

  if (rawAgentId === undefined) {
    return usage(app, t(locale, 'cli.agentBindRequiresIds'))
  }

  if (!app.resolve('agents').has(rawAgentId)) {
    return usage(app, t(locale, 'cli.agentUnknownAgent', { id: rawAgentId }))
  }

  await app.resolve('chatBindingStore').put({
    channel,
    chatId,
    agentId: agentId(rawAgentId),
    userId: LOCAL_USER_ID,
  })
  app.out(
    success(t(locale, 'cli.agentBound', { channel: String(channel), chatId, agentId: rawAgentId }))
  )

  return 0
}

async function unbindChat(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const target = requireChatTarget(args, app)

  if (target.kind === 'error') {
    return usage(app, `agent unbind ${target.error}`)
  }

  const { channel, chatId } = target.value

  await app.resolve('chatBindingStore').remove(channel, chatId)
  app.out(success(t(locale, 'cli.agentUnbound', { channel: String(channel), chatId })))

  return 0
}

async function listBindings(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const bindings = await app.resolve('chatBindingStore').list()

  if (bindings.length === 0) {
    app.out(hint(t(locale, 'cli.agentNoBindings')))

    return 0
  }

  for (const binding of bindings) {
    app.out(
      t(locale, 'cli.agentBindingLine', {
        channel: String(binding.channel),
        chatId: binding.chatId,
        agentId: binding.agentId,
        userId: binding.userId,
      })
    )
  }

  return 0
}
