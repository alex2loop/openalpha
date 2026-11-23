import type { AgentId, SessionId } from '@/core/ids'
import type { ProviderModelId } from '@/core/llm'
import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { AgentProfile, AgentRegistry, RunInput } from '@/engine/api'

const MESSAGE_KEYS = [
  'slash.modelCurrent',
  'slash.modelUnavailable',
  'slash.modelUnknown',
  'slash.modelSet',
] as const

const DESCRIPTION = { kind: 'localized', key: 'slash.modelHelp' } as const
const READ_POLICY = {
  surfaces: ['channel', 'repl'] as const,
  role: 'member' as const,
  action: 'read' as const,
}
const MUTATE_POLICY = {
  surfaces: ['channel'] as const,
  role: 'operator' as const,
  action: 'mutate' as const,
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
}
const MAX_SESSION_OVERRIDES = 1_024

export interface ModelSummary {
  readonly currentSelector: string | null
  readonly selectors: readonly string[]
}

export interface ModelControl {
  read(sessionId: SessionId, agentId: AgentId): ModelSummary
  set(sessionId: SessionId, agentId: AgentId, selector: string): boolean
}

export interface SelectableModel {
  readonly selector: string
  readonly providerModel: ProviderModelId
}

export interface SessionModelSelection {
  readonly control: ModelControl
  readonly agentForRun: (input: RunInput, fallback: AgentProfile) => AgentProfile
}

interface SessionModel {
  readonly agentId: AgentId
  readonly selector: string
  readonly providerModel: ProviderModelId
}

interface AgentOverrideInput {
  readonly input: RunInput
  readonly fallback: AgentProfile
}

export function createSessionModelSelection(
  agents: AgentRegistry,
  selectableModels: readonly SelectableModel[]
): SessionModelSelection {
  const bySelector = new Map(
    selectableModels.map((selectable) => [selectable.selector, selectable])
  )
  const selectors = [...bySelector.keys()]
  const selected = new Map<SessionId, SessionModel>()

  const read = (sessionId: SessionId, agentId: AgentId): ModelSummary => {
    const agent = agents.get(agentId)
    const selection = ownSelection(selected, sessionId, agentId)

    if (agent === null) {
      if (selection !== undefined) {
        selected.delete(sessionId)
      }

      return { currentSelector: null, selectors: [] }
    }

    if (selection !== undefined) {
      const selectable = bySelector.get(selection.selector)

      if (
        selectable !== undefined &&
        isSameProviderModel(selection.providerModel, selectable.providerModel)
      ) {
        remember(selected, sessionId, selection)
        return { currentSelector: selectable.selector, selectors }
      }

      selected.delete(sessionId)
    }

    return {
      currentSelector: defaultSelector(agent.preferredProviderModel, selectableModels),
      selectors,
    }
  }

  const control: ModelControl = {
    read,
    set(sessionId, agentId, selector): boolean {
      const summary = read(sessionId, agentId)
      const selectable = bySelector.get(selector)

      if (!summary.selectors.includes(selector) || selectable === undefined) {
        return false
      }

      remember(selected, sessionId, { agentId, selector, providerModel: selectable.providerModel })
      evictOldest(selected)
      return true
    },
  }

  return {
    control,
    agentForRun: (input, fallback) => applyAgentOverride(selected, bySelector, { input, fallback }),
  }
}

// Another agent's run (/research) neither takes the chat's choice nor clears it.
function ownSelection(
  selected: ReadonlyMap<SessionId, SessionModel>,
  sessionId: SessionId,
  agentId: AgentId
): SessionModel | undefined {
  const selection = selected.get(sessionId)

  return selection?.agentId === agentId ? selection : undefined
}

function applyAgentOverride(
  selected: Map<SessionId, SessionModel>,
  bySelector: ReadonlyMap<string, SelectableModel>,
  options: AgentOverrideInput
): AgentProfile {
  const { input, fallback } = options
  const selection = ownSelection(selected, input.sessionId, input.agentId)

  if (selection === undefined) {
    return fallback
  }

  const selectable = bySelector.get(selection.selector)

  if (
    selectable === undefined ||
    !isSameProviderModel(selection.providerModel, selectable.providerModel)
  ) {
    selected.delete(input.sessionId)
    return fallback
  }

  remember(selected, input.sessionId, selection)
  return {
    ...fallback,
    model: selectable.providerModel.model,
    preferredProviderModel: selectable.providerModel,
    modelChain: { kind: 'primary' },
  }
}

function defaultSelector(
  preferredProviderModel: AgentProfile['preferredProviderModel'],
  selectableModels: readonly SelectableModel[]
): string | null {
  if (preferredProviderModel === undefined) {
    return null
  }

  return (
    selectableModels.find((selectable) =>
      isSameProviderModel(selectable.providerModel, preferredProviderModel)
    )?.selector ?? null
  )
}

export interface ModelCommandDeps {
  readonly control: ModelControl
  readonly agentFor: (ctx: SlashContext) => Promise<AgentId>
}

export function createModelCommand(deps: ModelCommandDeps): SlashCommand {
  return {
    name: 'model',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: READ_POLICY,
    policyFor: (args) => (args.length > 0 ? MUTATE_POLICY : READ_POLICY),
    run: async (ctx): Promise<SlashResult> => runModelCommand(deps, ctx),
  }
}

async function runModelCommand(deps: ModelCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const agentId = await deps.agentFor(ctx)
  const summary = deps.control.read(ctx.sessionId, agentId)

  if (ctx.args.length > 1) {
    return unknownModelResult(ctx.args.join(' '), summary.selectors)
  }

  const requested = ctx.args[0]

  if (requested === undefined) {
    return summary.currentSelector === null
      ? {
          kind: 'message',
          messages: [
            { key: 'slash.modelUnavailable', values: { list: summary.selectors.join(', ') } },
          ],
        }
      : {
          kind: 'message',
          messages: [
            {
              key: 'slash.modelCurrent',
              values: { selector: summary.currentSelector, list: summary.selectors.join(', ') },
            },
          ],
        }
  }

  if (!deps.control.set(ctx.sessionId, agentId, requested)) {
    return unknownModelResult(requested, summary.selectors)
  }

  return {
    kind: 'message',
    messages: [{ key: 'slash.modelSet', values: { selector: requested } }],
  }
}

function unknownModelResult(selector: string, selectors: readonly string[]): SlashResult {
  return {
    kind: 'message',
    messages: [{ key: 'slash.modelUnknown', values: { selector, list: selectors.join(', ') } }],
  }
}

// Re-inserted so the map's order is recency: the oldest entry is the first.
function remember(
  selected: Map<SessionId, SessionModel>,
  sessionId: SessionId,
  selection: SessionModel
): void {
  selected.delete(sessionId)
  selected.set(sessionId, selection)
}

function evictOldest(selected: Map<SessionId, SessionModel>): void {
  while (selected.size > MAX_SESSION_OVERRIDES) {
    const oldest = selected.keys().next().value

    if (oldest === undefined) {
      return
    }

    selected.delete(oldest)
  }
}

function isSameProviderModel(left: ProviderModelId, right: ProviderModelId): boolean {
  return left.provider === right.provider && left.model === right.model
}
