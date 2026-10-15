import type { InstallDeps, InstallPreview } from '@/social/install'
import type { PinChanges } from '@/social/pin/diff'
import type { SocialLabel } from '@/social/skill/labels'
import type { SkillFinding } from '@/social/skill/scan'
import type { NetworkPin } from '@/social/types'
import { BRAND } from '@/core/brand'
import { ValidationError } from '@/core/errors'
import {
  applyLabels,
  fetchSource,
  filesOrRefuse,
  pinOrRefuse,
  toPreview,
  unknownNetwork,
} from '@/social/install'
import { carryLabels, findingKey, isSameContent, pinChanges } from '@/social/pin/diff'
import { scanSocialSkill } from '@/social/skill/scan'

export interface UpdatePreview extends InstallPreview {
  /** The pending bundle this preview shows; approval names it, so it approves what was shown. */
  readonly pinId: string
  readonly changes: PinChanges
  /** Findings the current pin did not already have, which is what `social update` shows. */
  readonly newFindings: readonly SkillFinding[]
  /** False when this content was already waiting, so the operator is not told twice. */
  readonly isNew: boolean
}

export async function stageUpdate(
  deps: InstallDeps,
  network: string,
  signal: AbortSignal
): Promise<UpdatePreview | undefined> {
  const pointer = await deps.bundles.readPointer(network)

  if (pointer === undefined) {
    throw unknownNetwork(network)
  }

  const current = await pinOrRefuse(deps.bundles, network, pointer.current)
  const fetched = await fetchSource(
    deps,
    { url: current.source, name: network, checkNameTaken: false, fallbackApiBase: current.apiBase },
    signal
  )
  const preview = toPreview(deps, {
    ...fetched,
    labels: carryLabels(current, fetched.parsed.endpoints),
    now: deps.now(),
  })

  if (isSameContent(current, preview.pin)) {
    return undefined
  }

  const subject = { network, current, currentId: pointer.current, preview }
  const pending =
    pointer.pending === undefined ? undefined : await readPending(deps, network, pointer.pending)

  if (
    pointer.pending !== undefined &&
    pending !== undefined &&
    isSameContent(pending, preview.pin)
  ) {
    return await toUpdate(deps, { ...subject, pinId: pointer.pending }, false)
  }

  const pinId = await writePending(deps, network, { currentId: pointer.current, preview })

  return pinId === undefined ? undefined : await toUpdate(deps, { ...subject, pinId }, true)
}

/** A `social update` or `social rollback` during the fetch is never undone by a stale write. */
async function writePending(
  deps: InstallDeps,
  network: string,
  staged: { readonly currentId: string; readonly preview: InstallPreview }
): Promise<string | undefined> {
  const pinId = await deps.bundles.write(staged.preview.pin, staged.preview.files)
  const fresh = await deps.bundles.readPointer(network)

  if (fresh === undefined || fresh.current !== staged.currentId) {
    deps.logger.warn('social.update_raced', { network })
    return undefined
  }

  await deps.bundles.writePointer(network, { ...fresh, pending: pinId })
  await deps.bundles.prune(network)

  return pinId
}

async function readPending(
  deps: InstallDeps,
  network: string,
  pinId: string
): Promise<NetworkPin | undefined> {
  const read = await deps.bundles.readPin(network, pinId)

  return read === 'mismatch' ? undefined : read
}

interface UpdateSubject {
  readonly network: string
  readonly current: NetworkPin
  readonly currentId: string
  readonly preview: InstallPreview
  readonly pinId: string
}

async function toUpdate(
  deps: InstallDeps,
  subject: UpdateSubject,
  isNew: boolean
): Promise<UpdatePreview> {
  const currentFiles = await filesOrRefuse(deps.bundles, subject.network, {
    id: subject.currentId,
    value: subject.current,
  })
  const hosts = {
    apiHost: new URL(subject.current.apiBase).hostname,
    skillHost: new URL(subject.current.source).hostname,
  }
  const known = new Set<string>()

  for (const [name, text] of currentFiles) {
    for (const finding of scanSocialSkill({ name, text }, hosts)) {
      known.add(findingKey(finding))
    }
  }

  return {
    ...subject.preview,
    pinId: subject.pinId,
    changes: pinChanges(subject.current, subject.preview.pin),
    newFindings: subject.preview.findings.filter((finding) => !known.has(findingKey(finding))),
    isNew,
  }
}

interface ApproveInput {
  readonly network: string
  readonly pinId: string
  readonly labels: ReadonlyMap<string, SocialLabel>
}

export async function approveUpdate(deps: InstallDeps, input: ApproveInput): Promise<void> {
  const { network } = input
  const pointer = await deps.bundles.readPointer(network)

  if (pointer?.pending === undefined) {
    throw new ValidationError(`${network} has no update waiting`, {
      key: 'social.noPending',
      params: { network },
    })
  }

  if (pointer.pending !== input.pinId) {
    throw new ValidationError(`${network} changed its skill again`, {
      key: 'social.pendingChanged',
      params: { network, brand: BRAND.name },
    })
  }

  const pending = await pinOrRefuse(deps.bundles, network, pointer.pending)
  const files = await filesOrRefuse(deps.bundles, network, { id: pointer.pending, value: pending })
  const approved: NetworkPin = {
    ...pending,
    endpoints: applyLabels(pending.endpoints, input.labels),
    approvedAt: deps.now(),
  }
  const pinId = await deps.bundles.write(approved, files)
  const current = await deps.bundles.readPin(network, pointer.current)

  await refuseKeysIfHostMoves(deps, network, { from: current, to: approved })
  await deps.bundles.writePointer(network, { current: pinId, previous: pointer.current })
  await deps.bundles.prune(network)
}

/** A key goes only to the host that issued it: members are refused before the pointer moves to
 *  another host (an unreadable pin counts as one), and only `social rekey` lifts it. */
async function refuseKeysIfHostMoves(
  deps: InstallDeps,
  network: string,
  move: { readonly from: NetworkPin | 'mismatch'; readonly to: NetworkPin }
): Promise<void> {
  if (move.from !== 'mismatch' && move.from.apiBase === move.to.apiBase) {
    return
  }

  for (const member of await deps.store.listMemberships({ network })) {
    await deps.store.setMembershipState(member.agentId, network, {
      state: 'refused',
      at: deps.now(),
    })
  }
}

export async function rollbackPin(deps: InstallDeps, network: string): Promise<void> {
  const pointer = await deps.bundles.readPointer(network)

  if (pointer === undefined) {
    throw unknownNetwork(network)
  }

  if (pointer.previous === undefined) {
    throw new ValidationError(`${network} has no previous pin`, {
      key: 'social.noPrevious',
      params: { network },
    })
  }

  const previous = await pinOrRefuse(deps.bundles, network, pointer.previous)
  const current = await deps.bundles.readPin(network, pointer.current)

  await refuseKeysIfHostMoves(deps, network, { from: current, to: previous })
  await deps.bundles.writePointer(network, {
    current: pointer.previous,
    previous: pointer.current,
    ...(pointer.pending === undefined ? {} : { pending: pointer.pending }),
  })
}
