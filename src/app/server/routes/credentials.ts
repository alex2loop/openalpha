import { z } from 'zod'

import type {
  CredentialGroup,
  CredentialRemoveResult,
  CredentialsResponse,
  CredentialWriteBody,
  CredentialWriteResult,
} from '@/app/server/wire/credentials'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { KeyEnvGroup, KeyFile } from '@/cli/api'
import type { ResolvedConfig } from '@/core/config/resolve'
import { buildProviderCatalog } from '@/app/server/cli/catalog'
import { buildServerOnlyText } from '@/app/server/exposure'
import { apiError, json } from '@/app/server/http/dispatch'
import { isExposedOnDisk } from '@/app/server/routes/config'
import { parsePathId, readJsonBody } from '@/app/server/routes/params'
import {
  getEnv,
  isRuntimeEnvName,
  keyEnvGroups,
  readEnvFile,
  removeEnvFileValue,
  writeEnvFileValue,
} from '@/cli/api'
import { BRAND, isControlEnvName } from '@/core/brand'
import { isEnvName, WEB_SEARCH_PROVIDERS } from '@/core/config/resolve'
import { FieldValidationError } from '@/core/field-errors'
import { formatErrForLog } from '@/core/security/credentials'

const CREDENTIAL_VALUE_MAX_CHARS = 4096
// The env file holds one `NAME=value` per line, so a value is one line of printable text.
const CONTROL_CHAR_RE = /\p{Cc}/u
const WRITE_BODY: z.ZodType<CredentialWriteBody> = z.object({ value: z.string() })
/** The groups the page may set, in the order it lists them. */
const PAGE_GROUPS: readonly CredentialGroup[] = ['provider', 'venue', 'search', 'source']
/** What only the server sets: the API token opens the API itself, the others reach a chat or a
 *  process the daemon starts. */
const SERVER_GROUPS: readonly KeyEnvGroup[] = ['token', 'mcp', 'channel']
const SERVER_ONLY_KEYS = Object.freeze({
  booted: 'errors.credentialsServerOnly',
  saved: 'errors.credentialsServerOnlySaved',
} as const)

// One env-file read-modify-write at a time: two saves at once would each rewrite the file from
// the same read and lose one key.
let envWriteTail: Promise<unknown> = Promise.resolve()

function serializeEnvWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = envWriteTail.then(op, op)

  envWriteTail = run

  return run
}

interface Credential {
  readonly name: string
  readonly group: CredentialGroup
  readonly subject: string
}

async function handleCredentials(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const keyFile = ctx.app.resolve('keyFile')
  const inFile = await readEnvFile(keyFile.path)
  const env = getEnv()

  return json({
    credentials: listCredentials(ctx.app.config).map((credential) => ({
      ...credential,
      set: inFile.has(credential.name),
      fromShell: isSetInShell(keyFile, env, credential.name),
    })),
    webSearch: { provider: ctx.app.config.webSearch.provider, providers: WEB_SEARCH_PROVIDERS },
  } satisfies CredentialsResponse)
}

async function handleCredentialWrite(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const refused = await refuseWhenExposed(req, ctx)

  if (refused !== undefined) {
    return refused
  }

  const name = parseAllowedName(req, ctx)
  const parsed = WRITE_BODY.safeParse(await readJsonBody(req))

  if (!(parsed.success && isCredentialValue(parsed.data.value))) {
    throw new FieldValidationError('invalid credential value', [
      { path: 'value', message: { key: 'errors.credentialValueInvalid' } },
    ])
  }

  try {
    await serializeEnvWrite(() =>
      writeEnvFileValue({
        path: ctx.app.resolve('keyFile').path,
        name,
        value: parsed.data.value,
      })
    )
  } catch (err: unknown) {
    ctx.app.resolve('logger').error('api.credentials_write_failed', {
      name,
      err: formatErrForLog(err),
    })

    return apiError('internal')
  }

  return json({ name, restartRequired: true } satisfies CredentialWriteResult)
}

async function handleCredentialRemove(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const refused = await refuseWhenExposed(req, ctx)

  if (refused !== undefined) {
    return refused
  }

  const name = parseAllowedName(req, ctx)
  const removed = await serializeEnvWrite(() =>
    removeEnvFileValue(ctx.app.resolve('keyFile').path, name)
  )

  return json({ removed } satisfies CredentialRemoveResult)
}

/** Every key variable the page may set: what the config reads for each page group, then every
 *  catalog provider's own variable, each name once; never a name a server group also reads. */
function listCredentials(config: ResolvedConfig): readonly Credential[] {
  const groups = keyEnvGroups(config)
  const serverOnly = new Set(SERVER_GROUPS.flatMap((group) => groups[group]).map((e) => e.name))
  const catalog = buildProviderCatalog().providers.map((provider) => ({
    name: provider.envVar,
    subject: provider.id,
  }))
  const listed = PAGE_GROUPS.flatMap((group) =>
    [...groups[group], ...(group === 'provider' ? catalog : [])].map((entry) => ({
      ...entry,
      group,
    }))
  )
  const seen = new Set<string>()

  return listed.filter((credential) => {
    const isNew = !seen.has(credential.name)

    seen.add(credential.name)

    return isNew && !serverOnly.has(credential.name) && isPageEnvName(credential.name)
  })
}

function isPageEnvName(name: string): boolean {
  return isEnvName(name) && !isControlEnvName(name) && !isRuntimeEnvName(name)
}

/** As `key list` reads it: the environment holds a value the key file did not put there. */
function isSetInShell(
  keyFile: KeyFile,
  env: Readonly<Record<string, string | undefined>>,
  name: string
): boolean {
  return (env[name] ?? '') !== '' && !keyFile.loaded.has(name)
}

function isCredentialValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= CREDENTIAL_VALUE_MAX_CHARS &&
    value === value.trim() &&
    !CONTROL_CHAR_RE.test(value)
  )
}

/** The path's name when the page may set it; a refusal naming it otherwise. */
function parseAllowedName(req: Request, ctx: ApiRouteContext): string {
  const name = parsePathId(req, (raw) => raw) ?? ''

  if (!listCredentials(ctx.app.config).some((credential) => credential.name === name)) {
    throw new FieldValidationError(`credential name not allowed: ${name}`, [
      { path: 'name', message: { key: 'errors.credentialNameNotAllowed', params: { name } } },
    ])
  }

  return name
}

/** Behind `public_url`, booted or saved for the next start, nobody at the page is known to be
 *  the operator: a key is set only on the server then. */
async function refuseWhenExposed(
  req: Request,
  ctx: ApiRouteContext
): Promise<Response | undefined> {
  if (!(await isExposedOnDisk(ctx))) {
    return undefined
  }

  const name = parsePathId(req, (raw) => raw) ?? ''

  return apiError(
    'conflict',
    buildServerOnlyText(ctx, SERVER_ONLY_KEYS, { brand: BRAND.name, name })
  )
}

export const CREDENTIAL_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/credentials', auth: true, handler: handleCredentials },
  { method: 'POST', path: '/v1/credentials/:name', auth: true, handler: handleCredentialWrite },
  { method: 'DELETE', path: '/v1/credentials/:name', auth: true, handler: handleCredentialRemove },
]
