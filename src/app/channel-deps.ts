import type { StartChannelsDeps } from '@/channels/api'
import type { App } from '@/core/container'
import { toAgentRegistry } from '@/app/services'

export function resolveChannelDeps(
  app: App,
  intakeSignal: AbortSignal,
  env: Record<string, string | undefined>
): StartChannelsDeps {
  return {
    definitions: app.resolve('channels'),
    config: app.config,
    runner: app.resolve('runner'),
    runRegistry: app.resolve('runRegistry'),
    sessionQueue: app.resolve('sessionQueue'),
    commandLane: app.resolve('commandLane'),
    costTracker: app.resolve('costTracker'),
    pairingStore: app.resolve('pairingStore'),
    sessionRouter: app.resolve('sessionRouter'),
    sessions: app.resolve('sessionStore'),
    spend: app.resolve('spendReader'),
    pollOffsets: app.resolve('pollOffsetStore'),
    inbox: app.resolve('inboundInbox'),
    bindings: app.resolve('chatBindingStore'),
    dispatcher: app.resolve('slashDispatcher'),
    agents: toAgentRegistry(app.resolve('agents')),
    operatorNotices: app.resolve('operatorNotices'),
    bus: app.resolve('bus'),
    logger: app.resolve('logger'),
    env,
    intakeSignal,
  }
}
