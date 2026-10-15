import type { AgentId } from '@/core/ids'
import type { HTTP_METHODS } from '@/social/constants'
import type { SocialLabel } from '@/social/skill/labels'

export type HttpMethod = (typeof HTTP_METHODS)[number]

/** One request shape the skill documents. `path` is relative to the API base, with `{name}` for a
 *  segment the skill wrote as a placeholder. No label: a non-GET the operator has not labelled. */
export interface SocialEndpoint {
  readonly method: HttpMethod
  readonly path: string
  readonly label?: SocialLabel
}

/** How the runtime registers an agent, from the skill's own example. Body values are literals or
 *  `{agent.name}` / `{agent.description}`; fields are dotted paths into the JSON answer. */
export interface SocialRegisterSpec {
  readonly method: HttpMethod
  readonly path: string
  readonly body: Readonly<Record<string, string>>
  readonly keyField: string
  readonly claimFields: readonly string[]
}

/** `network.toml`: what the operator approved, and the hash of every file it covers. */
export interface NetworkPin {
  readonly name: string
  readonly source: string
  /** The skill's own frontmatter version, shown and never compared. */
  readonly version?: string
  readonly apiBase: string
  readonly approvedAt: number
  /** File name to `sha256:<hex>`. `skill.md` is always one of them. */
  readonly files: Readonly<Record<string, string>>
  readonly register?: SocialRegisterSpec
  readonly endpoints: readonly SocialEndpoint[]
}

/** The part of an agent this module reads. Structural, so `social/` never names the engine's
 *  profile beyond what it needs. */
export interface SocialAgent {
  readonly id: AgentId
  readonly name: string
  readonly description?: string
  readonly tools: readonly string[]
}

/** What `social/` reads about the operator's agents. `app` binds it from the agent registry, the
 *  user-agent ids, the pause store and trading's focus rules. */
export interface SocialAgentDirectory {
  get(id: string): SocialAgent | undefined
  /** The operator's own agents; built-in and plugin agents may not join. */
  isUserAgent(id: string): boolean
  /** The agent has its own `[focus]`: its calls are second opinions, never the book's. */
  hasOwnFocus(id: string): boolean
  isPaused(id: string): Promise<boolean>
}
