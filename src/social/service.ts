import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type {
  SocialNetworkState,
  SocialPauseReason,
  SocialStore,
  SocialWriteRow,
} from '@/core/types/social'
import type { SocialConfig } from '@/social/config'
import type { InstallInput, InstallPreview } from '@/social/install'
import type { JoinInput, JoinOutcome, MembershipDeps, SocialMemberView } from '@/social/membership'
import type { SocialNotifier } from '@/social/notices'
import type { SocialReply } from '@/social/request/outcome'
import type { SocialLabel } from '@/social/skill/labels'
import type { SocialAgentDirectory } from '@/social/types'
import type { UpdatePreview } from '@/social/update'
import { BRAND } from '@/core/brand'
import { ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { SKILL_FILE } from '@/social/constants'
import { createSocialKeyFiles } from '@/social/credentials'
import {
  type ApproveOutcome,
  approveDraft,
  createDraft,
  type DraftDeps,
  discardDraft,
  draftRefusal,
  findDraftView,
  listDraftViews,
  type SocialDraftView,
} from '@/social/drafts'
import { commitInstall, previewInstall, removeInstall } from '@/social/install'
import {
  isMember,
  joinNetwork,
  leaveNetwork,
  listMemberViews,
  previewRegistration,
  rekeyMembership,
  setMemberState,
  setReview,
  toAgentId,
} from '@/social/membership'
import { createSocialBundles, type SocialBundles } from '@/social/pin/bundle'
import {
  decideRequest,
  isRefused,
  membershipStep,
  pausePinMismatch,
  type RequestDeps,
  type SocialRequestInput,
} from '@/social/request/checks'
import { executeRequest, refusedReply } from '@/social/request/outcome'
import { createReadLimiter } from '@/social/request/rate'
import { createKeyedSerial } from '@/social/request/serial'
import { approveUpdate, rollbackPin, stageUpdate } from '@/social/update'
import { runSocialUpkeep } from '@/social/upkeep'
import { type SocialVisit, visitsFor } from '@/social/visit'

/** What `social log` shows: the newest writes, never the whole history. */
const LIST_WRITES_LIMIT = 50

declare module '@/core/container' {
  interface Services {
    socialService: SocialService
  }
}

interface SocialServiceDeps {
  readonly config: SocialConfig
  readonly store: SocialStore
  readonly dataDir: string
  readonly logger: Logger
  readonly agents: SocialAgentDirectory
  readonly notifier: SocialNotifier
  /** `[locale] timezone`: a daily cap counts the operator's day. */
  readonly timeZone: string
  tools(): ReadonlyMap<string, ToolDefinition>
  now(): number
}

export interface SocialNetworkView {
  readonly name: string
  readonly state: SocialNetworkState
  readonly pauseReason?: SocialPauseReason
  readonly version?: string
  /** Absent when the pinned files cannot be read. */
  readonly apiBase?: string
  readonly updateWaiting: boolean
  /** Non-GET endpoints with no label, which stay blocked until the operator labels them. */
  readonly unlabelled: number
}

export interface SocialService {
  previewAdd(input: InstallInput, signal: AbortSignal): Promise<InstallPreview>
  add(preview: InstallPreview): Promise<void>
  stageUpdate(network: string, signal: AbortSignal): Promise<UpdatePreview | undefined>
  approveUpdate(input: {
    readonly network: string
    readonly pinId: string
    readonly labels: ReadonlyMap<string, SocialLabel>
  }): Promise<void>
  rollback(network: string): Promise<void>
  /** Only once no agent is a member: the row and pinned files go, the network account stays. */
  remove(network: string): Promise<void>
  listNetworks(): Promise<readonly SocialNetworkView[]>
  /** True when the state changed. */
  setNetworkState(network: string, state: SocialNetworkState): Promise<boolean>
  /** The registration body a `join` without a key would send; `undefined` when there is none. */
  previewRegistration(
    input: Pick<JoinInput, 'agentId' | 'network' | 'publicName'>
  ): Promise<Readonly<Record<string, string>> | undefined>
  join(input: JoinInput, signal: AbortSignal): Promise<JoinOutcome>
  leave(agentId: string, network: string): Promise<void>
  rekey(agentId: string, network: string, apiKey: string): Promise<void>
  setReview(agentId: string, network: string, on: boolean): Promise<void>
  setMemberState(agentId: string, network: string, state: 'active' | 'paused'): Promise<void>
  listMembers(): Promise<readonly SocialMemberView[]>
  isMember(agentId: string): Promise<boolean>
  /** The pinned skill has a `verify` endpoint, which an approved draft cannot answer. */
  hasVerifyEndpoint(network: string): Promise<boolean>
  request(input: SocialRequestInput, signal: AbortSignal): Promise<SocialReply>
  readSkill(agentId: AgentId, network: string, file?: string): Promise<SocialReply>
  listDrafts(): Promise<readonly SocialDraftView[]>
  /** One waiting draft as `social approve` shows it; refuses `social.noSuchDraft`. */
  findDraft(id: string): Promise<SocialDraftView>
  approveDraft(id: string, signal: AbortSignal): Promise<ApproveOutcome>
  discardDraft(id: string): Promise<void>
  upkeep(signal: AbortSignal): Promise<void>
  listWrites(agentId: string, network?: string): Promise<readonly SocialWriteRow[]>
  /** One heartbeat visit per network this agent may visit now; `app` maps them to tasks. */
  visitsFor(agentId: AgentId): Promise<readonly SocialVisit[]>
}

type InstallMethods = Pick<
  SocialService,
  | 'previewAdd'
  | 'add'
  | 'stageUpdate'
  | 'approveUpdate'
  | 'rollback'
  | 'remove'
  | 'listNetworks'
  | 'setNetworkState'
  | 'hasVerifyEndpoint'
  | 'upkeep'
>

type MemberMethods = Pick<
  SocialService,
  | 'previewRegistration'
  | 'join'
  | 'leave'
  | 'rekey'
  | 'setReview'
  | 'setMemberState'
  | 'listMembers'
  | 'isMember'
  | 'listWrites'
>

type RequestMethods = Pick<
  SocialService,
  'request' | 'readSkill' | 'listDrafts' | 'findDraft' | 'approveDraft' | 'discardDraft'
>

export function createSocialService(deps: SocialServiceDeps): SocialService {
  const bundles = createSocialBundles(deps.dataDir)
  const membership: MembershipDeps = {
    config: deps.config,
    store: deps.store,
    bundles,
    keys: createSocialKeyFiles(deps.dataDir, deps.logger),
    agents: deps.agents,
    tools: deps.tools,
    logger: deps.logger,
    now: deps.now,
  }
  // Both live as long as the service and are never module state: concurrent runs share neither.
  const requestDeps: RequestDeps = {
    ...membership,
    reads: createReadLimiter(),
    notifier: deps.notifier,
    timeZone: deps.timeZone,
  }

  return {
    ...installMethods(deps, bundles),
    ...memberMethods(deps, membership),
    ...requestMethods({ ...requestDeps, serial: createKeyedSerial() }),
    visitsFor: (agentId) => visitsFor(requestDeps, agentId),
  }
}

function installMethods(deps: SocialServiceDeps, bundles: SocialBundles): InstallMethods {
  const install = { store: deps.store, bundles, logger: deps.logger, now: deps.now }

  return {
    previewAdd: (input, signal) => previewInstall(install, input, signal),
    add: (preview) => commitInstall(install, preview),
    stageUpdate: (network, signal) => stageUpdate(install, network, signal),
    approveUpdate: (input) => approveUpdate(install, input),
    rollback: (network) => rollbackPin(install, network),
    remove: (network) => removeInstall(install, network),
    listNetworks: () => listNetworkViews(deps, bundles),
    setNetworkState: (network, state) => setState(deps, { network, state }),
    hasVerifyEndpoint: (network) => hasVerifyEndpoint(bundles, network),
    upkeep: (signal) =>
      runSocialUpkeep(
        { install, store: deps.store, notifier: deps.notifier, logger: deps.logger, now: deps.now },
        signal
      ),
  }
}

function memberMethods(deps: SocialServiceDeps, membership: MembershipDeps): MemberMethods {
  return {
    previewRegistration: (input) => previewRegistration(membership, input),
    join: (input, signal) => joinNetwork(membership, input, signal),
    leave: (agentId, network) => leaveNetwork(membership, { agentId, network }),
    rekey: (agentId, network, apiKey) => rekeyMembership(membership, { agentId, network, apiKey }),
    setReview: (agentId, network, on) => setReview(membership, { agentId, network, on }),
    setMemberState: (agentId, network, state) =>
      setMemberState(membership, { agentId, network, state }),
    listMembers: () => listMemberViews(membership, deps.now()),
    isMember: (agentId) => isMember(membership, agentId),
    listWrites: (agent, network) =>
      deps.store.listWrites({
        agentId: toAgentId(agent),
        ...(network === undefined ? {} : { network }),
        limit: LIST_WRITES_LIMIT,
      }),
  }
}

function requestMethods(deps: DraftDeps): RequestMethods {
  return {
    request: (input, signal) =>
      deps.serial.run(`${input.agentId}:${input.network}`, () => runRequest(deps, input, signal)),
    readSkill: (agentId, network, file) => readSkill(deps, { agentId, network, file }),
    listDrafts: () => listDraftViews(deps),
    findDraft: (id) => findDraftView(deps, id),
    approveDraft: (id, signal) => approveDraft(deps, id, signal),
    discardDraft: (id) => discardDraft(deps, id),
  }
}

async function runRequest(
  deps: RequestDeps,
  input: SocialRequestInput,
  signal: AbortSignal
): Promise<SocialReply> {
  const decision = await decideRequest(deps, input, { approving: false })

  if (decision.kind === 'refused') {
    return refusedReply(decision, input.network)
  }

  if (decision.kind === 'draft') {
    const refusal = await draftRefusal(deps, decision)

    if (refusal !== undefined) {
      return refusedReply({ refusal }, input.network)
    }

    const id = await createDraft(deps, decision)

    // A draft is not an error, but the model must hear plainly that nothing went out.
    return { kind: 'refused', refusal: 'drafted', params: { id, reason: decision.reason } }
  }

  return await executeRequest(deps, decision.context, signal)
}

async function readSkill(
  deps: RequestDeps,
  input: { readonly agentId: AgentId; readonly network: string; readonly file: string | undefined }
): Promise<SocialReply> {
  const member = await membershipStep(deps, input)

  if (isRefused(member)) {
    return refusedReply(member, input.network)
  }

  const file = input.file ?? SKILL_FILE
  const names = Object.keys(member.pin.files)

  if (!names.includes(file)) {
    return { kind: 'refused', refusal: 'unknown-file', params: { files: names.join(', ') } }
  }

  const text = await deps.bundles.readFile(input.network, member.pinId, file)

  if (text === 'mismatch') {
    await pausePinMismatch(deps, input.network)

    return { kind: 'refused', refusal: 'pin-mismatch', params: { network: input.network } }
  }

  const others = names.filter((name) => name !== file)

  return {
    kind: 'text',
    text:
      input.file === undefined && others.length > 0
        ? `${text}\n\nOther pinned files: ${others.join(', ')}`
        : text,
  }
}

async function hasVerifyEndpoint(bundles: SocialBundles, network: string): Promise<boolean> {
  const pointer = await bundles.readPointer(network)
  const pin = pointer === undefined ? undefined : await bundles.readPin(network, pointer.current)

  return pin !== undefined && pin !== 'mismatch' && pin.endpoints.some((e) => e.label === 'verify')
}

async function listNetworkViews(
  deps: SocialServiceDeps,
  bundles: SocialBundles
): Promise<readonly SocialNetworkView[]> {
  const rows = await deps.store.listNetworks()
  const views: SocialNetworkView[] = []

  for (const row of rows) {
    const view = await readPinView(deps, bundles, row.name)

    views.push({
      name: row.name,
      state: row.state,
      ...(row.pauseReason === undefined ? {} : { pauseReason: row.pauseReason }),
      ...view,
    })
  }

  return views
}

async function readPinView(
  deps: SocialServiceDeps,
  bundles: SocialBundles,
  network: string
): Promise<Pick<SocialNetworkView, 'version' | 'apiBase' | 'updateWaiting' | 'unlabelled'>> {
  try {
    const pointer = await bundles.readPointer(network)
    const pin = pointer === undefined ? undefined : await bundles.readPin(network, pointer.current)

    if (pointer === undefined || pin === undefined || pin === 'mismatch') {
      throw new ValidationError('pin unreadable')
    }

    return {
      ...(pin.version === undefined ? {} : { version: pin.version }),
      apiBase: pin.apiBase,
      updateWaiting: pointer.pending !== undefined,
      unlabelled: pin.endpoints.filter((e) => e.method !== 'GET' && e.label === undefined).length,
    }
  } catch (err: unknown) {
    deps.logger.warn('social.pin_unreadable', { network, err: formatErrForLog(err) })

    return { updateWaiting: false, unlabelled: 0 }
  }
}

async function setState(
  deps: SocialServiceDeps,
  input: { readonly network: string; readonly state: SocialNetworkState }
): Promise<boolean> {
  if ((await deps.store.findNetwork(input.network)) === undefined) {
    throw new ValidationError(`unknown network ${input.network}`, {
      key: 'social.unknownNetwork',
      params: { network: input.network, brand: BRAND.name },
    })
  }

  return await deps.store.setNetworkState(input.network, input.state, {
    reason: 'operator',
    at: deps.now(),
  })
}
