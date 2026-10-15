import type { SocialLabel } from '@/social/skill/labels'
import type { SkillFinding } from '@/social/skill/scan'
import type { NetworkPin, SocialEndpoint } from '@/social/types'
import { canonicalJson } from '@/core/utils/hash'

export interface PinChanges {
  readonly changedFiles: readonly string[]
  readonly removedFiles: readonly string[]
  readonly newEndpoints: readonly SocialEndpoint[]
  readonly removedEndpoints: readonly SocialEndpoint[]
  readonly apiBaseChanged: boolean
}

export function endpointKey(endpoint: SocialEndpoint): string {
  return `${endpoint.method} ${endpoint.path}`
}

/** The operator's past labels for endpoints the new skill still has. A dropped endpoint's label is
 *  dropped with it, never an error, or one removed endpoint would stop every future check. */
export function carryLabels(
  current: NetworkPin,
  fetched: readonly SocialEndpoint[]
): ReadonlyMap<string, SocialLabel> {
  const present = new Set(fetched.map(endpointKey))
  const labels = new Map<string, SocialLabel>()

  for (const endpoint of current.endpoints) {
    if (endpoint.label !== undefined && present.has(endpointKey(endpoint))) {
      labels.set(endpointKey(endpoint), endpoint.label)
    }
  }

  return labels
}

export function isSameContent(a: NetworkPin, b: NetworkPin): boolean {
  const view = (pin: NetworkPin): string =>
    canonicalJson({
      apiBase: pin.apiBase,
      files: pin.files,
      register: pin.register ?? null,
      endpoints: pin.endpoints.map((e) => [e.method, e.path, e.label ?? null]),
    })

  return view(a) === view(b)
}

export function findingKey(finding: SkillFinding): string {
  return `${finding.file}\n${finding.kind}\n${finding.excerpt}`
}

export function pinChanges(current: NetworkPin, next: NetworkPin): PinChanges {
  const currentKeys = new Set(current.endpoints.map(endpointKey))
  const nextKeys = new Set(next.endpoints.map(endpointKey))

  return {
    changedFiles: Object.keys(next.files).filter(
      (name) => current.files[name] !== next.files[name]
    ),
    removedFiles: Object.keys(current.files).filter((name) => next.files[name] === undefined),
    newEndpoints: next.endpoints.filter((e) => !currentKeys.has(endpointKey(e))),
    removedEndpoints: current.endpoints.filter((e) => !nextKeys.has(endpointKey(e))),
    apiBaseChanged: current.apiBase !== next.apiBase,
  }
}
