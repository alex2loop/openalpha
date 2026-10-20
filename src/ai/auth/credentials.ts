import type { TokenFile } from '@/ai/auth/token-file'
import type { AccessToken, AuthProvider, CredentialSource, StoredTokens } from '@/ai/auth/types'
import type { ProviderEntry } from '@/ai/catalog'
import type { Logger } from '@/core/logging/logger'
import { resolveTokenFetcher } from '@/ai/auth/cloud/identity'
import { AUTH_PROVIDERS } from '@/ai/auth/registry'
import { createTokenFile } from '@/ai/auth/token-file'
import { PROVIDERS } from '@/ai/catalog'
import { LLMError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/core/utils/time'

const REFRESH_SKEW_MS = 5 * MS_PER_MINUTE
const EXPIRY_MARGIN_MS = 30 * MS_PER_SECOND
const REFRESH_RETRY_PAUSE_MS = 30 * MS_PER_SECOND

/** When a failed refresh may be tried again; shared by every call on one credential source. */
interface RefreshPause {
  until: number
}

interface OAuthCredentialsInput {
  readonly authProvider: AuthProvider
  readonly tokenFile: TokenFile
  readonly logger: Logger
}

interface CredentialSourcesInput {
  readonly dataDir: string
  readonly logger: Logger
  readonly env: Readonly<Record<string, string | undefined>>
}

export function createCredentialSources(
  input: CredentialSourcesInput
): readonly CredentialSource[] {
  const logins = AUTH_PROVIDERS.map((authProvider) =>
    createOAuthCredentials({
      authProvider,
      tokenFile: createTokenFile(input.dataDir, authProvider.id),
      logger: input.logger,
    })
  )
  const providers: readonly ProviderEntry[] = PROVIDERS
  const identities = providers.flatMap((provider) => {
    const fetchToken =
      provider.identity === undefined
        ? undefined
        : resolveTokenFetcher(provider.identity, input.env)

    return fetchToken === undefined
      ? []
      : [createCloudCredentials({ provider: provider.id, fetchToken, logger: input.logger })]
  })

  return [...logins, ...identities]
}

/** Read from the file on every call, never held in memory: a logout or a login to another account
 *  takes effect on the next call, without a restart. One small file read is nothing beside the
 *  model call it authorizes. */
function createOAuthCredentials(input: OAuthCredentialsInput): CredentialSource {
  const { authProvider, tokenFile } = input
  const pause: RefreshPause = { until: 0 }
  let inFlight: Promise<StoredTokens> | undefined

  async function load(): Promise<StoredTokens> {
    const stored = await tokenFile.read()

    if (stored === undefined) {
      throw new LLMError(
        'auth',
        `no login found for ${authProvider.id} — run the auth login command`
      )
    }

    return stored
  }

  // Load, expiry check and refresh run as one flight: a caller that loaded the file before a
  // concurrent refresh landed would otherwise redeem the already-rotated refresh token.
  async function currentTokens(): Promise<StoredTokens> {
    const stored = await load()

    return isRefreshDue(stored.expiresAt, pause)
      ? refreshStored({ ...input, pause }, stored)
      : stored
  }

  return Object.freeze({
    provider: authProvider.id,
    // No `AbortSignal` param (see `CredentialSource`): `inFlight` is shared by every concurrent turn
    // on this provider, so this call must run to completion even if the turn that triggered it is
    // cancelled — aborting it would strand the other turns awaiting the same refresh.
    async authHeaders(): Promise<Readonly<Record<string, string>>> {
      inFlight ??= currentTokens().finally(() => {
        inFlight = undefined
      })

      return authProvider.authHeaders(await inFlight)
    },
  })
}

async function refreshStored(
  source: OAuthCredentialsInput & { readonly pause: RefreshPause },
  stored: StoredTokens
): Promise<StoredTokens> {
  const { authProvider, tokenFile, logger, pause } = source
  const tokens = await refreshOrKeep({
    refresh: () => authProvider.refresh(stored.refreshToken),
    expiresAt: stored.expiresAt,
    pause,
    provider: authProvider.id,
    logger,
  })

  if (tokens === undefined) {
    return stored
  }

  const claims = authProvider.parseClaims(tokens.accessToken)
  const next: StoredTokens = {
    ...tokens,
    accountId: claims?.accountId ?? stored.accountId,
    ...(claims?.planType === undefined ? {} : { planType: claims.planType }),
    ...(claims?.email === undefined ? {} : { email: claims.email }),
  }

  // A logout or a new login while the refresh was in flight wins: writing now would sign the
  // operator back in, or back into the old account.
  const current = await tokenFile.read()

  if (current === undefined) {
    throw new LLMError('auth', `${authProvider.id} was logged out during a token refresh`)
  }

  if (current.refreshToken !== stored.refreshToken) {
    return current
  }

  await tokenFile.write(next)
  logger.debug('ai.oauth_token_refreshed', {
    provider: authProvider.id,
    expiresAt: next.expiresAt,
  })

  return next
}

/** A cloud token lives in memory only: it is minted from the operator's own credentials on demand,
 *  so there is nothing to persist, and a restart simply mints the next one. */
function createCloudCredentials(input: {
  readonly provider: string
  readonly fetchToken: () => Promise<AccessToken>
  readonly logger: Logger
}): CredentialSource {
  const { provider, fetchToken, logger } = input
  const pause: RefreshPause = { until: 0 }
  let cached: AccessToken | undefined
  let inFlight: Promise<AccessToken> | undefined

  async function current(): Promise<AccessToken> {
    const held = cached

    if (held !== undefined && !isRefreshDue(held.expiresAt, pause)) {
      return held
    }

    inFlight ??= fetchToken().finally(() => {
      inFlight = undefined
    })
    const flight = inFlight

    if (held === undefined) {
      cached = await flight

      return cached
    }

    const fresh = await refreshOrKeep({
      refresh: () => flight,
      expiresAt: held.expiresAt,
      pause,
      provider,
      logger,
    })

    cached = fresh ?? held

    return cached
  }

  return Object.freeze({
    provider,
    async authHeaders(): Promise<Readonly<Record<string, string>>> {
      return { authorization: `Bearer ${(await current()).accessToken}` }
    },
  })
}

function isRefreshDue(expiresAt: number, pause: RefreshPause): boolean {
  const now = Date.now()
  const leftMs = expiresAt - now

  return leftMs < REFRESH_SKEW_MS && (now >= pause.until || leftMs <= EXPIRY_MARGIN_MS)
}

/** Undefined keeps the token in hand: a failed refresh falls back to it while it has life left and
 *  pauses further tries, so calls do not all wait on a failing token endpoint. */
async function refreshOrKeep<T>(input: {
  readonly refresh: () => Promise<T>
  readonly expiresAt: number
  readonly pause: RefreshPause
  readonly provider: string
  readonly logger: Logger
}): Promise<T | undefined> {
  try {
    return await input.refresh()
  } catch (err: unknown) {
    if (input.expiresAt - Date.now() <= EXPIRY_MARGIN_MS) {
      throw err
    }

    input.pause.until = Date.now() + REFRESH_RETRY_PAUSE_MS
    input.logger.warn('ai.token_refresh_deferred', {
      provider: input.provider,
      err: formatErrForLog(err),
    })

    return undefined
  }
}
