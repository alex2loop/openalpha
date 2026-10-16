import type { DeliveryHub } from '@/app/services'
import type { App, ServiceProvider } from '@/core/container'
import type { AgentProfile } from '@/engine/api'
import type { HeartbeatTask } from '@/scheduler/api'
import type { SocialAgentDirectory, SocialConfig, SocialNotifier } from '@/social/api'
import { SOCIAL_CHANNEL } from '@/core/channels'
import { OperatorConfigError } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'
import { agentId } from '@/core/ids'
import {
  createSocialService,
  createSocialSlashCommand,
  createSocialTools,
  renderSocialNotice,
  validateSocialTools,
} from '@/social/api'
import { isBookFocus, resolveRunFocus } from '@/trading/api'

interface SocialProviderInput {
  readonly config: SocialConfig
  readonly delivery: DeliveryHub
}

/** Step 8c: after the tools (6) and slash commands (8) it extends are bound, and before user agents
 *  (12), so the two social tools exist before any agent names them. */
export function createSocialProvider(input: SocialProviderInput): ServiceProvider {
  return {
    name: 'social',
    register(bind, extend): void {
      bind('socialService', (app) =>
        createSocialService({
          config: input.config,
          store: app.resolve('socialStore'),
          dataDir: app.config.paths.dataDir,
          logger: app.resolve('logger'),
          agents: createSocialAgentDirectory(app),
          notifier: createSocialNotifier(input.delivery, app),
          timeZone: app.config.locale.timezone,
          tools: () => app.resolve('tools'),
          now: () => Date.now(),
        })
      )
      extend('commands', (current, app) => [
        ...current,
        createSocialSlashCommand(() => app.resolve('socialService'), app.config.locale.timezone),
      ])
      extend('tools', (current, app) => {
        const tools = new Map(current)

        for (const tool of createSocialTools(() => app.resolve('socialService'))) {
          if (tools.has(tool.name)) {
            throw new ConfigError(`duplicate tool name: ${tool.name}`)
          }

          tools.set(tool.name, tool)
        }

        return tools
      })
    },
  }
}

// `agents`, `userAgentIds` and `tools` are read per call: they are complete only after step 12.
function createSocialAgentDirectory(app: App): SocialAgentDirectory {
  const pauses = app.resolve('agentPauseStore')

  return {
    get: (id) => app.resolve('agents').get(id),
    isUserAgent: (id) => app.resolve('userAgentIds').has(agentId(id)),
    hasOwnFocus: (id) => !isBookFocus(resolveRunFocus(app.resolve('agents').get(id)?.focus)),
    isPaused: (id) => pauses.isPaused(agentId(id)),
  }
}

/** A social notice goes to the default recipient; with none attached (a CLI process), it is logged
 *  and dropped, because the CLI already tells the operator what happened. */
function createSocialNotifier(delivery: DeliveryHub, app: App): SocialNotifier {
  return {
    async notify(notice) {
      const target = delivery.defaultRecipient()

      if (target === undefined) {
        app.resolve('logger').info('social.notice_unrouted', { kind: notice.kind })
        return
      }

      await delivery.sink.notify(target, renderSocialNotice(app.config.locale.language, notice))
    },
  }
}

/** The rules hold against the final registry, MCP included. Run once composition is complete. */
export function assertSocialToolRules(app: App, config: SocialConfig): void {
  const { missing, refused } = validateSocialTools(config.allowedTools, app.resolve('tools'))

  if (missing.length > 0) {
    throw new ConfigError(`social default tools are not registered: ${missing.join(', ')}`)
  }

  if (refused.length > 0) {
    throw new OperatorConfigError(
      `[social] allowed_tools names unknown or refused tools: ${refused.join(', ')}`,
      { key: 'errors.configSocialToolsRefused', params: { tools: refused.join(', ') } },
      { path: ['social', 'allowed_tools'] }
    )
  }
}

/** Each active membership becomes an isolated, tool-restricted heartbeat task. Its notices go to
 *  the default recipient through the scheduler's own `[HEARTBEAT_RESPOND]` path. */
export function createSocialHeartbeatTasks(
  app: App,
  delivery: DeliveryHub
): (agent: AgentProfile) => Promise<readonly HeartbeatTask[]> {
  return async (agent) => {
    const visits = await app.resolve('socialService').visitsFor(agent.id)
    const target = delivery.defaultRecipient()
    const deliver = target === undefined ? {} : { deliver: [`${target.channel}:${target.chatId}`] }

    return visits.map(
      (visit): HeartbeatTask => ({
        name: visit.name,
        intervalMs: visit.intervalMs,
        prompt: visit.prompt,
        session: 'isolated',
        duplicateWindowMs: visit.duplicateWindowMs,
        keepsCommitments: false,
        ...deliver,
        ...(visit.activeHours === undefined ? {} : { activeHours: visit.activeHours }),
        run: {
          allowedTools: visit.allowedTools,
          maxTurns: visit.maxTurns,
          maxDurationMs: visit.maxDurationMs,
          channel: SOCIAL_CHANNEL,
        },
      })
    )
  }
}
