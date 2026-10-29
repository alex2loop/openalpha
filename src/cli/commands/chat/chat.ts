import { randomUUID } from 'node:crypto'

import type { ChatFlags, ReplState } from '@/cli/commands/chat/types'
import type { CliApp, LocalizedText } from '@/cli/types'
import type { ChannelId } from '@/core/channels'
import type { AgentId, SessionId } from '@/core/ids'
import { type Command, createCommand } from '@/cli/command'
import { repl, singleShot } from '@/cli/commands/chat/repl'
import { CLI_CHAT_ID } from '@/cli/commands/chat/types'
import { usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagBool, flagString, parseIntFlagStrict } from '@/cli/parsing/args'
import { resolveChatCompletion, resolveChatDisplay } from '@/cli/services'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { agentId as brandAgentId, DEFAULT_AGENT_ID, LOCAL_USER_ID, sessionId } from '@/core/ids'
import { isEntryAgent } from '@/engine/api'
import { t } from '@/i18n'

// One operator on one machine, so the CLI has a single stable chat.
const APPROVAL_MODES = ['manual', 'bypass'] as const
const CLI_CHANNEL_ID = LOCAL_CHANNEL_ID

interface FlagOk extends ChatFlags {
  readonly kind: 'value'
}

interface FlagError {
  readonly kind: 'error'
  readonly error: LocalizedText
}

interface OpenError {
  readonly kind: 'error'
  readonly error: string
}

type FlagResult = FlagOk | FlagError
type OpenSessionResult = { readonly kind: 'value'; readonly state: ReplState } | OpenError

export const handleChat: Command = createCommand({
  ...CLI_COMMAND_METADATA.chat,
  spec: {
    flags: {
      agent: { type: 'string', alias: 'a', describe: { key: 'cliHelp.flagChatAgent' } },
      message: { type: 'string', alias: 'm', describe: { key: 'cliHelp.flagChatMessage' } },
      mode: {
        type: 'string',
        choices: APPROVAL_MODES,
        describe: { key: 'cliHelp.flagChatMode' },
      },
      continue: { type: 'boolean', alias: 'c', describe: { key: 'cliHelp.flagChatContinue' } },
      // Spec keys are camelCase; parseArgs camelCases the token before lookup.
      maxTurns: { type: 'string', describe: { key: 'cliHelp.flagChatMaxTurns' } },
      maxCostUsd: { type: 'string', describe: { key: 'cliHelp.flagChatMaxCostUsd' } },
    },
  },
  validate: (args): LocalizedText | undefined => {
    const flags = readFlags(args)

    return flags.kind === 'error' ? flags.error : undefined
  },
  async run(args, app): Promise<number> {
    const flags = readFlags(args)

    if (flags.kind === 'error') {
      return usage(app, renderLocalized(app.config.locale.language, flags.error))
    }

    const opened = await openSession(app, flags)

    if (opened.kind === 'error') {
      return usage(app, opened.error)
    }

    const { state } = opened
    const session = {
      app,
      flags,
      state,
      display: resolveChatDisplay(app, state.agentId),
      completion: resolveChatCompletion(app),
    }

    return flags.message === undefined ? repl(session) : singleShot(session, flags.message)
  },
})

function readFlags(args: Parameters<Parameters<typeof createCommand>[0]['run']>[0]): FlagResult {
  const maxTurns = parseIntFlagStrict(flagString(args, 'maxTurns'), '--max-turns')

  if (maxTurns.kind === 'error') {
    return maxTurns
  }

  const maxTurnsValue = maxTurns.kind === 'value' ? maxTurns.value : undefined

  const rawCost = flagString(args, 'maxCostUsd')
  const maxCostUsd = rawCost === undefined ? undefined : Number(rawCost)

  if (maxCostUsd !== undefined && !(Number.isFinite(maxCostUsd) && maxCostUsd > 0)) {
    return {
      kind: 'error',
      error: { key: 'cli.chatMaxCostInvalid', params: { value: rawCost ?? '' } },
    }
  }

  const mode = flagString(args, 'mode')

  if (mode !== undefined && !isApprovalMode(mode)) {
    return {
      kind: 'error',
      error: {
        key: 'cli.chatModeInvalid',
        params: { choices: APPROVAL_MODES.join(' | '), value: mode },
      },
    }
  }

  // Hoisted so the narrowing sticks under exactOptionalPropertyTypes.
  const agent = flagString(args, 'agent')
  // Whitespace-only is the same ask as no message at all: without this it bills a full turn.
  const message = flagString(args, 'message')?.trim()

  if (message === '') {
    return { kind: 'error', error: { key: 'cli.chatMessageEmpty' } }
  }

  return {
    kind: 'value',
    continue: flagBool(args, 'continue'),
    ...(agent === undefined ? {} : { agent }),
    ...(message === undefined ? {} : { message }),
    ...(mode === undefined ? {} : { mode }),
    ...(maxTurnsValue === undefined ? {} : { maxTurns: maxTurnsValue }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
  }
}

function isApprovalMode(value: string): value is 'manual' | 'bypass' {
  return value === 'manual' || value === 'bypass'
}

// Reuses the durable SessionRouter, so --continue survives a restart.
async function openSession(app: CliApp, flags: ChatFlags): Promise<OpenSessionResult> {
  const router = app.resolve('sessionRouter')
  const store = app.resolve('sessionStore')
  const key = { channel: CLI_CHANNEL_ID, chatId: CLI_CHAT_ID, userId: LOCAL_USER_ID }
  const existing = flags.continue ? await router.get(key) : null
  const snapshot = existing === null ? null : await store.loadDetails(existing)
  const requested = resolveAgent(flags)
  const agent = snapshot?.session.agentId ?? requested
  const locale = app.config.locale.language

  if (snapshot !== null && flags.agent !== undefined && requested !== agent) {
    return {
      kind: 'error',
      error: t(locale, 'cli.chatContinueAgentConflict', { requested, stored: agent }),
    }
  }

  if (!isEntryAgent(app.resolve('agents').get(agent))) {
    return { kind: 'error', error: t(locale, 'cli.agentUnknown', { id: agent }) }
  }

  const id = snapshot === null ? await mintSession(app, key) : snapshot.session.id

  return {
    kind: 'value',
    state: {
      sessionId: id,
      agentId: agent,
      controller: null,
      printer: null,
    },
  }
}

async function mintSession(
  app: CliApp,
  key: { channel: ChannelId; chatId: string; userId: typeof LOCAL_USER_ID }
): Promise<SessionId> {
  const fresh = sessionId(randomUUID())
  await app.resolve('sessionRouter').put(key, fresh)

  return fresh
}

function resolveAgent(flags: ChatFlags): AgentId {
  return flags.agent === undefined ? DEFAULT_AGENT_ID : brandAgentId(flags.agent)
}
