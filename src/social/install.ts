import { rm } from 'node:fs/promises'

import type { Logger } from '@/core/logging/logger'
import type { SocialStore } from '@/core/types/social'
import type { SocialBundles } from '@/social/pin/bundle'
import type { SocialLabel } from '@/social/skill/labels'
import type { ParsedSkill } from '@/social/skill/parse'
import type { SkillFinding } from '@/social/skill/scan'
import type { NetworkPin, SocialEndpoint } from '@/social/types'
import { BRAND } from '@/core/brand'
import { ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { SKILL_FILE } from '@/social/constants'
import { toApiBase } from '@/social/pin/api-base'
import { endpointKey } from '@/social/pin/diff'
import { fetchSkillFile } from '@/social/skill/fetch'
import { assertNetworkName, parseSkill } from '@/social/skill/parse'
import { scanSocialSkill } from '@/social/skill/scan'

export interface InstallInput {
  readonly url: string
  readonly name?: string
  readonly apiBase?: string
  /** `"<METHOD> <path>"` to the label the operator chose over the suggestion. */
  readonly labels: ReadonlyMap<string, SocialLabel>
}

export interface InstallPreview {
  readonly pin: NetworkPin
  /** File name to text, `skill.md` included, exactly what will be written. */
  readonly files: ReadonlyMap<string, string>
  readonly findings: readonly SkillFinding[]
}

export interface InstallDeps {
  readonly store: SocialStore
  readonly bundles: SocialBundles
  readonly logger: Logger
  now(): number
}

interface PreviewSource extends FetchedSource {
  readonly labels: ReadonlyMap<string, SocialLabel>
  readonly now: number
}

const NAME_FROM_HOST_RE = /^(?:www\.)?([a-z0-9-]+)\./

interface FetchedSource {
  readonly name: string
  readonly source: string
  readonly parsed: ParsedSkill
  readonly files: ReadonlyMap<string, string>
}

export async function previewInstall(
  deps: InstallDeps,
  input: InstallInput,
  signal: AbortSignal
): Promise<InstallPreview> {
  const fetched = await fetchSource(deps, input, signal)

  return toPreview(deps, { ...fetched, labels: input.labels, now: deps.now() })
}

export async function fetchSource(
  deps: InstallDeps,
  input: Omit<InstallInput, 'labels'> & {
    readonly checkNameTaken?: boolean
    readonly fallbackApiBase?: string
  },
  signal: AbortSignal
): Promise<FetchedSource> {
  const source = parseHttpsUrl(input.url)
  const text = await fetchSkillFile(source.href, signal)
  const parsed = parseSkill(text, {
    url: source.href,
    ...(input.apiBase === undefined ? {} : { apiBase: input.apiBase }),
    ...(input.fallbackApiBase === undefined ? {} : { fallbackApiBase: input.fallbackApiBase }),
  })
  // A name taken from the host is a proposal: the preview prints it first and the confirmation
  // names it, which is how the operator is asked.
  const name = input.name ?? parsed.name ?? nameFromHost(source)

  assertNetworkName(name)

  if (input.checkNameTaken !== false && (await deps.store.findNetwork(name)) !== undefined) {
    throw nameTaken(name)
  }

  const files = new Map<string, string>([[SKILL_FILE, text]])

  // One after another: a `Promise.all` would leave siblings running when one throws.
  for (const file of parsed.files) {
    files.set(file.name, await fetchSkillFile(file.url, signal))
  }

  return { name, source: source.href, parsed, files }
}

/** A malformed or plain-http address is the operator's typo, so it reads as one. */
function parseHttpsUrl(url: string): URL {
  const parsed = URL.parse(url)

  if (parsed?.protocol !== 'https:') {
    throw new ValidationError(`not an https url: ${url}`, {
      key: 'social.fetchFailed',
      params: { url },
    })
  }

  return parsed
}

function nameFromHost(source: URL): string {
  return NAME_FROM_HOST_RE.exec(`${source.hostname}.`)?.[1] ?? source.hostname
}

function nameTaken(network: string): ValidationError {
  return new ValidationError(`network ${network} already exists`, {
    key: 'social.nameTaken',
    params: { network },
  })
}

export function toPreview(deps: InstallDeps, input: PreviewSource): InstallPreview {
  const apiBase = toApiBase(input.parsed.apiBase)
  const hashes: Record<string, string> = {}
  const findings: SkillFinding[] = []
  const hosts = { apiHost: new URL(apiBase).hostname, skillHost: new URL(input.source).hostname }

  for (const [name, text] of input.files) {
    hashes[name] = deps.bundles.hashOf(text)
    findings.push(...scanSocialSkill({ name, text }, hosts))
  }

  const { version, register } = input.parsed

  return {
    pin: {
      name: input.name,
      source: input.source,
      ...(version === undefined ? {} : { version }),
      apiBase,
      approvedAt: input.now,
      files: hashes,
      ...(register === undefined ? {} : { register }),
      endpoints: applyLabels(input.parsed.endpoints, input.labels),
    },
    files: input.files,
    findings,
  }
}

/** The pin with the operator's label corrections, as a preview shows them before the OK. */
export function withLabels(pin: NetworkPin, labels: ReadonlyMap<string, SocialLabel>): NetworkPin {
  return { ...pin, endpoints: applyLabels(pin.endpoints, labels) }
}

export function applyLabels(
  endpoints: readonly SocialEndpoint[],
  labels: ReadonlyMap<string, SocialLabel>
): readonly SocialEndpoint[] {
  const known = new Set(endpoints.map(endpointKey))

  for (const key of labels.keys()) {
    if (!known.has(key)) {
      throw new ValidationError(`${key} is not an endpoint of this skill`, {
        key: 'social.labelUnknown',
        params: { endpoint: key },
      })
    }
  }

  return endpoints.map((endpoint) => {
    const label = labels.get(endpointKey(endpoint)) ?? endpoint.label

    return {
      method: endpoint.method,
      path: endpoint.path,
      ...(label === undefined ? {} : { label }),
    }
  })
}

export async function commitInstall(deps: InstallDeps, preview: InstallPreview): Promise<void> {
  const { name } = preview.pin

  if (!(await deps.store.addNetwork(name, deps.now()))) {
    throw nameTaken(name)
  }

  try {
    const pinId = await deps.bundles.write(preview.pin, preview.files)

    await deps.bundles.writePointer(name, { current: pinId })
  } catch (err: unknown) {
    // Install either completes or writes nothing.
    await deps.store.removeNetwork(name)
    await rm(deps.bundles.folderOf(name), { recursive: true, force: true })
    throw err
  }
}

export function unknownNetwork(network: string): ValidationError {
  return new ValidationError(`unknown network ${network}`, {
    key: 'social.unknownNetwork',
    params: { network, brand: BRAND.name },
  })
}

function damaged(network: string): ValidationError {
  return new ValidationError('network pin is damaged', {
    key: 'social.pinDamaged',
    params: { brand: BRAND.name, network },
  })
}

/** Every install-side reader treats a hash mismatch the same way. */
export async function pinOrRefuse(
  bundles: SocialBundles,
  network: string,
  pin: string
): Promise<NetworkPin> {
  const read = await bundles.readPin(network, pin)

  if (read === 'mismatch') {
    throw damaged(network)
  }

  return read
}

export async function filesOrRefuse(
  bundles: SocialBundles,
  network: string,
  pin: { readonly id: string; readonly value: NetworkPin }
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>()

  for (const name of Object.keys(pin.value.files)) {
    const text = await bundles.readFile(network, pin.id, name)

    if (text === 'mismatch') {
      throw damaged(network)
    }

    files.set(name, text)
  }

  return files
}

export async function removeInstall(deps: InstallDeps, network: string): Promise<void> {
  if ((await deps.store.findNetwork(network)) === undefined) {
    throw unknownNetwork(network)
  }

  const members = await deps.store.listMemberships({ network })

  if (members.length > 0) {
    throw new ValidationError(`${network} still has members`, {
      key: 'social.networkHasMembers',
      params: {
        network,
        agents: members.map((member) => member.agentId).join(', '),
        brand: BRAND.name,
      },
    })
  }

  await deps.store.removeNetwork(network)

  try {
    await rm(deps.bundles.folderOf(network), { recursive: true, force: true })
  } catch (err: unknown) {
    // The row is gone, so nothing reads the folder, and a later add writes a fresh pin beside it.
    deps.logger.warn('social.folder_remove_failed', { network, err: formatErrForLog(err) })
  }
}
