import type { HttpMethod, SocialEndpoint, SocialRegisterSpec } from '@/social/types'
import { ValidationError } from '@/core/errors'
import { withoutTrailingSlashes } from '@/core/utils/url'
import { parseFrontmatter } from '@/engine/api'
import { SKILL_FILE, SKILL_FILE_NAME_RE } from '@/social/constants'
import { type CurlCommand, curlCommands, isHttpMethod, parseUrl } from '@/social/skill/curl'
import { type SocialLabel, suggestLabel } from '@/social/skill/labels'

const NETWORK_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
/** Anything the parser keeps from the skill is printed on the operator's terminal and written to
 *  `network.toml`, so it is held to a plain shape at the source. */
const TEMPLATE_PATH_RE = /^\/[A-Za-z0-9._~{}/-]*$/
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/
const PLACEHOLDER_SEGMENT_RE = /^[A-Z][A-Z0-9_]*$/
const PLACEHOLDER_NAME_RE = /^\{(.+)\}$/
const METHOD_LINE_RE = /^\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/
const NON_REST_RE = /(graphql|jsonrpc)/i
const KEY_FIELD_RE = /(^|_)(api_?key|token)$/
const CLAIM_FIELD_RE = /(claim|verification)/
const MD_URL_RE =
  /https:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?\/[^\s"'`)<>\]]{0,512}?\.md(?![A-Za-z0-9])/g
/** A skill points at a few guides; more is a network trying to fill the disk on each check. */
const MAX_COMPANION_FILES = 16
/** Moltbook lists 39; a list this long is a network trying to bury the preview. */
const MAX_ENDPOINTS = 200
const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)```/g
const REGISTER_PATH_RE = /\/register$/
const ENCODED_OPEN_RE = /%7B/gi
const ENCODED_CLOSE_RE = /%7D/gi
const MAX_FRONT_DEPTH = 4
const MAX_ANSWER_DEPTH = 3
const AGENT_BODY_FIELDS: Readonly<Record<string, string>> = {
  name: '{agent.name}',
  description: '{agent.description}',
}

interface SkillSource {
  readonly url: string
  /** `--api-base`, for a skill that does not declare one. */
  readonly apiBase?: string
  /** Only when neither the flag nor the skill names one: an update keeps the pinned base. */
  readonly fallbackApiBase?: string
}

interface SkillFileRef {
  readonly name: string
  readonly url: string
}

export interface ParsedSkill {
  readonly name?: string
  readonly version?: string
  readonly apiBase: string
  readonly files: readonly SkillFileRef[]
  readonly endpoints: readonly SocialEndpoint[]
  readonly register?: SocialRegisterSpec
}

interface RawEndpoint {
  readonly method: HttpMethod
  readonly path: string
}

export function assertNetworkName(name: string): void {
  if (!NETWORK_NAME_RE.test(name)) {
    refuse('social.badName', { name })
  }
}

export function parseSkill(text: string, source: SkillSource): ParsedSkill {
  const front = parseFrontmatter(text)
  const skillUrl = new URL(source.url)
  const apiBase = parseApiBase(source.apiBase ?? declaredApiBase(front) ?? source.fallbackApiBase)
  const commands = curlCommands(text)
  const version = front.version

  assertRestOnly(commands, apiBase, skillUrl)

  return {
    ...(front.name === undefined ? {} : { name: front.name }),
    ...(version === undefined || !VERSION_RE.test(version) ? {} : { version }),
    apiBase: withoutTrailingSlashes(apiBase.href),
    files: companionFiles(text, skillUrl),
    endpoints: endpointsOf(text, commands, apiBase),
    ...registerOf(text, commands, apiBase),
  }
}

function refuse(key: string, params?: Readonly<Record<string, string | number>>): never {
  throw new ValidationError(key, { key, ...(params === undefined ? {} : { params }) })
}

function parseApiBase(raw: string | undefined): URL {
  try {
    return new URL(raw ?? '')
  } catch {
    return refuse('social.noApiBase')
  }
}

function declaredApiBase(front: Readonly<Record<string, string>>): string | undefined {
  for (const [key, value] of Object.entries(front)) {
    if (key.endsWith('api_base') && value !== '') {
      return value
    }
  }

  for (const value of Object.values(front)) {
    const found = value.trimStart().startsWith('{') ? apiBaseInJson(value) : undefined

    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

function apiBaseInJson(raw: string): string | undefined {
  try {
    return findApiBase(JSON.parse(raw), 0)
  } catch {
    return undefined
  }
}

function findApiBase(node: unknown, depth: number): string | undefined {
  if (depth > MAX_FRONT_DEPTH || typeof node !== 'object' || node === null) {
    return undefined
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'api_base' && typeof value === 'string') {
      return value
    }

    const nested = findApiBase(value, depth + 1)

    if (nested !== undefined) {
      return nested
    }
  }

  return undefined
}

function assertRestOnly(commands: readonly CurlCommand[], apiBase: URL, skillUrl: URL): void {
  for (const command of commands) {
    if (NON_REST_RE.test(command.url.href) || NON_REST_RE.test(command.body ?? '')) {
      refuse('social.notRest')
    }

    if (command.url.hostname !== apiBase.hostname && command.url.hostname !== skillUrl.hostname) {
      refuse('social.otherApiHost')
    }

    if (command.authSchemes.some((scheme) => scheme.toLowerCase() !== 'bearer')) {
      refuse('social.authScheme')
    }
  }
}

/** A path under the API base, relative to it; `undefined` for anything outside it. */
function relativePath(pathname: string, apiBase: URL): string | undefined {
  const basePath = withoutTrailingSlashes(apiBase.pathname)
  const decoded = pathname.replace(ENCODED_OPEN_RE, '{').replace(ENCODED_CLOSE_RE, '}')

  if (basePath === '') {
    return decoded
  }

  return decoded === basePath || decoded.startsWith(`${basePath}/`)
    ? decoded.slice(basePath.length)
    : undefined
}

function endpointsOf(
  text: string,
  commands: readonly CurlCommand[],
  apiBase: URL
): readonly SocialEndpoint[] {
  const raw: RawEndpoint[] = []

  for (const command of commands) {
    const path =
      command.url.origin === apiBase.origin
        ? relativePath(command.url.pathname, apiBase)
        : undefined

    if (path !== undefined) {
      raw.push({ method: command.method, path })
    }
  }

  for (const line of text.split('\n')) {
    const match = METHOD_LINE_RE.exec(line)
    const method = match?.[1]
    const written = match?.[2]

    if (method !== undefined && written !== undefined && isHttpMethod(method)) {
      // The network's own answers repeat the base path (`POST /api/v1/verify`).
      raw.push({ method, path: relativePath(written, apiBase) ?? written })
    }
  }

  const endpoints = finishEndpoints(raw)

  if (endpoints.length > MAX_ENDPOINTS) {
    refuse('social.tooManyEndpoints', { max: MAX_ENDPOINTS })
  }

  return endpoints
}

function finishEndpoints(raw: readonly RawEndpoint[]): readonly SocialEndpoint[] {
  const templated = raw
    .map((endpoint) => ({ method: endpoint.method, path: toTemplate(endpoint.path) }))
    .filter((endpoint) => TEMPLATE_PATH_RE.test(endpoint.path))
  const labels = new Map<string, SocialLabel | undefined>()
  const endpoints = new Map<string, RawEndpoint>()

  unifyPlaceholders(templated).forEach((endpoint, index) => {
    const key = `${endpoint.method} ${endpoint.path}`
    const original = templated[index]?.path ?? endpoint.path
    // `DELETE /agents/me` merged into `/agents/{name}` must not trade `account` for `delete`: a
    // label every source path agrees on is kept, and any other is left for the operator.
    const label = agreedLabel(
      suggestLabel(endpoint.method, endpoint.path),
      suggestLabel(endpoint.method, original)
    )

    labels.set(key, endpoints.has(key) ? agreedLabel(labels.get(key), label) : label)
    endpoints.set(key, endpoint)
  })

  return [...endpoints]
    .map(([key, endpoint]) => withLabel(endpoint, labels.get(key)))
    .sort((a, b) => compareText(a.path, b.path) || compareText(a.method, b.method))
}

function agreedLabel(
  a: SocialLabel | undefined,
  b: SocialLabel | undefined
): SocialLabel | undefined {
  return a === b ? a : undefined
}

function withLabel(endpoint: RawEndpoint, label: SocialLabel | undefined): SocialEndpoint {
  return { method: endpoint.method, path: endpoint.path, ...(label === undefined ? {} : { label }) }
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0
  }

  return a < b ? -1 : 1
}

/** `POST_ID` becomes `{post_id}`; a literal such as `general` stays until `unifyPlaceholders`. */
function toTemplate(path: string): string {
  const bare = withoutTrailingSlashes(path.split('?')[0] ?? '')

  return bare
    .split('/')
    .map((segment) =>
      PLACEHOLDER_SEGMENT_RE.test(segment) ? `{${segment.toLowerCase()}}` : segment
    )
    .join('/')
}

/** A skill shows some calls with a placeholder and the same kind of call with an example value. A
 *  literal segment becomes `{x}` when another template of the same length has `{x}` at the same
 *  position under the same leading segments, so `/agents/me` never turns into `/agents/{name}`
 *  because `/agents/{name}/follow` exists. One pass over the original segments, no recursion. */
function unifyPlaceholders(templates: readonly RawEndpoint[]): readonly RawEndpoint[] {
  const split = templates.map((template) => template.path.split('/'))

  return templates.map((template, index) => {
    const segments = split[index] ?? []
    const unified = segments.map((segment, position) =>
      PLACEHOLDER_NAME_RE.test(segment)
        ? segment
        : (placeholderAt(split, segments, position) ?? segment)
    )

    return { method: template.method, path: unified.join('/') }
  })
}

function placeholderAt(
  split: readonly (readonly string[])[],
  segments: readonly string[],
  position: number
): string | undefined {
  for (const other of split) {
    const candidate = other[position]

    if (
      other.length === segments.length &&
      candidate !== undefined &&
      PLACEHOLDER_NAME_RE.test(candidate) &&
      segments.slice(0, position).every((segment, i) => other[i] === segment)
    ) {
      return candidate
    }
  }

  return undefined
}

function registerOf(
  text: string,
  commands: readonly CurlCommand[],
  apiBase: URL
): { readonly register?: SocialRegisterSpec } {
  for (const command of commands) {
    const path = relativePath(command.url.pathname, apiBase)

    if (command.method !== 'POST' || path === undefined || !REGISTER_PATH_RE.test(path)) {
      continue
    }

    const body = registerBody(command.body)
    const fields = body === undefined ? undefined : answerFields(text.slice(command.endIndex))

    if (body !== undefined && fields !== undefined) {
      return { register: { method: 'POST', path, body, ...fields } }
    }
  }

  return {}
}

/** Agent-shaped fields only: a body asking for anything else is not one the runtime can fill. */
function registerBody(raw: string | undefined): Record<string, string> | undefined {
  const parsed = parseJson(raw)

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }

  const body: Record<string, string> = {}

  for (const key of Object.keys(parsed)) {
    const value = AGENT_BODY_FIELDS[key]

    if (value === undefined) {
      return undefined
    }

    body[key] = value
  }

  return Object.keys(body).length === 0 ? undefined : body
}

function answerFields(
  rest: string
): { readonly keyField: string; readonly claimFields: readonly string[] } | undefined {
  for (const match of rest.matchAll(JSON_BLOCK_RE)) {
    const parsed = parseJson(match[1])

    if (parsed === undefined) {
      continue
    }

    const leaves = leafPaths(parsed, '', 0)
    const keyField = leaves.find((leaf) => KEY_FIELD_RE.test(lastSegment(leaf)))

    return keyField === undefined
      ? undefined
      : {
          keyField,
          claimFields: leaves.filter((leaf) => CLAIM_FIELD_RE.test(lastSegment(leaf))),
        }
  }

  return undefined
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1)
}

function leafPaths(node: unknown, prefix: string, depth: number): readonly string[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return prefix === '' ? [] : [prefix]
  }

  if (depth > MAX_ANSWER_DEPTH) {
    return []
  }

  return Object.entries(node).flatMap(([key, value]) =>
    leafPaths(value, prefix === '' ? key : `${prefix}.${key}`, depth + 1)
  )
}

function parseJson(raw: string | undefined): unknown {
  try {
    return raw === undefined ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Every `.md` file the skill points at must come from the skill's own host: whatever the agent may
 *  later read through `social_skill` is what the skill's site published. */
function companionFiles(text: string, skillUrl: URL): readonly SkillFileRef[] {
  const files = new Map<string, SkillFileRef>()

  for (const url of new Set(text.match(MD_URL_RE) ?? [])) {
    const parsed = parseUrl(url)

    if (parsed === undefined || parsed.href === skillUrl.href) {
      continue
    }

    if (parsed.hostname !== skillUrl.hostname) {
      refuse('social.fileElsewhere', { url })
    }

    const name = parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1).toLowerCase()

    // A companion may not stand in for `skill.md`, and names compare lowercased because two names
    // that differ by case are one file on a case-insensitive disk.
    if (!SKILL_FILE_NAME_RE.test(name) || name === SKILL_FILE) {
      continue
    }

    if (files.has(name)) {
      refuse('social.fileNameClash', { name })
    }

    if (files.size >= MAX_COMPANION_FILES) {
      refuse('social.tooManyFiles', { max: MAX_COMPANION_FILES })
    }

    files.set(name, { name, url: parsed.href })
  }

  return [...files.values()]
}
