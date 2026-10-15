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
    const selection = selected.get(sessionId)

    if (agent === null) {
      selected.delete(sessionId)
      return { currentSelector: null, selectors: [] }
    }

    if (selection !== undefined) {
      const selectable = bySelector.get(selection.selector)

      if (
        selectable !== undefined &&
        selection.agentId === agentId &&
        isSameProviderModel(selection.providerModel, selectable.providerModel)
      ) {
        selected.delete(sessionId)
        selected.set(sessionId, selection)
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

      selected.delete(sessionId)
      selected.set(sessionId, { agentId, selector, providerModel: selectable.providerModel })
      evictOldest(selected)
      return true
    },
  }

  return {
    control,
    agentForRun: (input, fallback) => applyAgentOverride(selected, bySelector, { input, fallback }),
  }
}

function applyAgentOverride(
  selected: Map<SessionId, SessionModel>,
  bySelector: ReadonlyMap<string, SelectableModel>,
  options: AgentOverrideInput
): AgentProfile {
  const { input, fallback } = options
  const selection = selected.get(input.sessionId)
  const selectable =
    selection?.agentId === input.agentId ? bySelector.get(selection.selector) : undefined

  if (
    selection === undefined ||
    selectable === undefined ||
    !isSameProviderModel(selection.providerModel, selectable.providerModel)
  ) {
    selected.delete(input.sessionId)
    return fallback
  }

  selected.delete(input.sessionId)
  selected.set(input.sessionId, selection)
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
    return {
      kind: 'message',
      messages: [
        { key: 'slash.modelUnknown', values: { selector: '', list: summary.selectors.join(', ') } },
      ],
    }
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
    return {
      kind: 'message',
      messages: [
        {
          key: 'slash.modelUnknown',
          values: { selector: requested, list: summary.selectors.join(', ') },
        },
      ],
    }
  }

  return {
    kind: 'message',
    messages: [{ key: 'slash.modelSet', values: { selector: requested } }],
  }
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
