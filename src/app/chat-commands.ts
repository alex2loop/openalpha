import { randomUUID } from 'node:crypto'

import type { App } from '@/core/container'
import type { AgentId, SessionId } from '@/core/ids'
import type { SlashCommand, SlashContext } from '@/core/types/command'
import type { RunResultReason } from '@/core/types/run'
import { toAgentRegistry } from '@/app/services'
import { createConfigSummary } from '@/app/views'
import { resolveRegisteredChannelSettings } from '@/channels/api'
import { createCoreCommands } from '@/commands/api'
import { toCommandLaneKey } from '@/core/command-lane'
import { agentId as brandAgentId, sessionId as brandSessionId, DEFAULT_AGENT_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

const COMPLETED_RUN: RunResultReason = 'completed'

interface EntryAgentSelectionOptions {
  readonly app: App
  readonly ctx: SlashContext
  readonly target: AgentId | 'default'
  readonly invalidate: () => void
}

interface FreshSessionOptions {
  readonly app: App
  readonly ctx: SlashContext
  readonly agentId: AgentId
  /** The agent to leave bound to the chat; omitting it clears the binding. */
  readonly binding?: AgentId
  readonly invalidate: () => void
}

// Built lazily: every core command needs a service that is not resolved at register time.
export function coreCommands(app: App): readonly SlashCommand[] {
  return createCoreCommands({
    agents: toAgentRegistry(app.resolve('agents')),
    memory: app.resolve('memory'),
    spend: {
      reader: app.resolve('spendReader'),
      maxDailyUsd: app.config.budget.maxDailyUsd,
    },
    healthSummary: app.resolve('healthSummary'),
    releases: app.resolve('releaseUpdates'),
    modelControl: app.resolve('modelControl'),
    schedulerCommands: app.resolve('schedulerCommands'),
    scopeFor: async (ctx) => ({ agentId: await entryAgent(app, ctx), userId: ctx.userId }),
    pausedAgents: app.resolve('agentPauseStore'),
    agentFor: (ctx) => entryAgent(app, ctx),
    selectAgent: (ctx, target) => selectEntryAgent(app, ctx, target),
    resetSession: (ctx) => resetChatSession(app, ctx),
    configSummary: createConfigSummary(app),
    continueCommand: {
      nudge: (locale) => t(locale, 'slash.continueNudge'),
      hasStoppedRun: (ctx) => hasStoppedRun(app, ctx),
    },
    logger: app.resolve('logger'),
  })
}

// Any end but a completed one left the request unfinished; a session that never ran has no end.
async function hasStoppedRun(app: App, ctx: SlashContext): Promise<boolean> {
  const snapshot = await app.resolve('sessionStore').loadDetails(ctx.sessionId)
  const endReason = snapshot?.session.endReason

  return endReason !== undefined && endReason !== COMPLETED_RUN
}

// The chat's bound agent, or the default when nothing is bound yet. One lookup, used by every
// command that needs to know whose agent it is acting as.
async function entryAgent(app: App, ctx: SlashContext): Promise<AgentId> {
  const binding = await app.resolve('chatBindingStore').get(ctx.channel, ctx.chatId)

  return binding?.agentId ?? configuredEntryAgent(app, ctx.channel)
}

async function selectEntryAgent(
  app: App,
  ctx: SlashContext,
  target: AgentId | 'default'
): Promise<void> {
  await app
    .resolve('sessionQueue')
    .coordinateChat({ channel: ctx.channel, chatId: ctx.chatId }, (invalidate) =>
      applyEntryAgentSelection({ app, ctx, target, invalidate })
    )
}

async function applyEntryAgentSelection(options: EntryAgentSelectionOptions): Promise<void> {
  const { app, ctx, target, invalidate } = options
  const binding = await app.resolve('chatBindingStore').get(ctx.channel, ctx.chatId)
  const defaultAgentId = configuredEntryAgent(app, ctx.channel)
  const currentAgentId = binding?.agentId ?? defaultAgentId
  const targetAgentId = target === 'default' ? defaultAgentId : target

  if (target === 'default' && binding?.agentId === defaultAgentId) {
    await app.resolve('chatBindingStore').remove(ctx.channel, ctx.chatId)
    return
  }

  if (currentAgentId === targetAgentId) {
    return
  }

  await startFreshSession({
    app,
    ctx,
    agentId: targetAgentId,
    ...(target === 'default' ? {} : { binding: target }),
    invalidate,
  })
}

// Keeps the chat on whatever agent it is already bound to; only the transcript is left behind.
async function resetChatSession(app: App, ctx: SlashContext): Promise<SessionId> {
  return await app
    .resolve('sessionQueue')
    .coordinateChat({ channel: ctx.channel, chatId: ctx.chatId }, async (invalidate) => {
      const binding = await app.resolve('chatBindingStore').get(ctx.channel, ctx.chatId)

      return await startFreshSession({
        app,
        ctx,
        agentId: binding?.agentId ?? configuredEntryAgent(app, ctx.channel),
        ...(binding === null ? {} : { binding: binding.agentId }),
        invalidate,
      })
    })
}

// Cancels whatever the chat had in flight, then routes it to a new session.
async function startFreshSession(options: FreshSessionOptions): Promise<SessionId> {
  const { app, ctx, agentId, binding, invalidate } = options

  invalidate()
  app.resolve('sessionQueue').cancelSession(ctx.sessionId)
  app.resolve('commandLane').cancel(toCommandLaneKey(ctx.channel, ctx.chatId))
  app.resolve('runRegistry').abortChat(ctx.channel, ctx.chatId)
  app.resolve('bus').emit('chat_session_reset', { channel: ctx.channel, chatId: ctx.chatId })
  app.resolve('bus').emit('session_ended', { sessionId: ctx.sessionId })

  const freshSessionId = brandSessionId(randomUUID())

  await app.resolve('sessionStore').create({
    id: freshSessionId,
    agentId,
    userId: ctx.userId,
    channel: ctx.channel,
    chatId: ctx.chatId,
  })

  try {
    await app.resolve('chatBindingStore').selectSession({
      channel: ctx.channel,
      chatId: ctx.chatId,
      userId: ctx.userId,
      sessionId: freshSessionId,
      ...(binding === undefined ? {} : { agentId: binding }),
    })
  } catch (err: unknown) {
    await discardFreshSession(app, freshSessionId)
    throw err
  }

  await closeReplacedSession(app, ctx.sessionId)

  return freshSessionId
}

// The store skips a session a run still holds; that run records its own end.
async function closeReplacedSession(app: App, sessionId: SessionId): Promise<void> {
  try {
    await app.resolve('sessionStore').updateStatus(sessionId, 'done')
  } catch (err: unknown) {
    app.resolve('logger').warn('agent.session_close_failed', { err: formatErrForLog(err) })
  }
}

async function discardFreshSession(app: App, freshSessionId: SessionId): Promise<void> {
  app.resolve('bus').emit('session_ended', { sessionId: freshSessionId })

  try {
    await app.resolve('sessionStore').remove(freshSessionId)
  } catch (removeErr: unknown) {
    app.resolve('logger').warn('agent.session_remove_failed', {
      err: formatErrForLog(removeErr),
    })
    await app
      .resolve('sessionStore')
      .updateStatus(freshSessionId, 'stale')
      .catch((markErr: unknown) => {
        app.resolve('logger').warn('agent.session_mark_stale_failed', {
          err: formatErrForLog(markErr),
        })
      })
  }
}

function configuredEntryAgent(app: App, channel: SlashContext['channel']): AgentId {
  const settings = resolveRegisteredChannelSettings(
    app.resolve('channels'),
    app.config.channels,
    channel
  )

  return settings?.agent === undefined ? DEFAULT_AGENT_ID : brandAgentId(settings.agent)
}
