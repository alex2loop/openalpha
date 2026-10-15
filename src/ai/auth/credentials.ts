import type { TokenFile } from '@/ai/auth/token-file'
import type { AccessToken, AuthProvider, CredentialSource, StoredTokens } from '@/ai/auth/types'
import type { ProviderEntry } from '@/ai/catalog'
import type { Logger } from '@/core/logging/logger'
import { resolveTokenFetcher } from '@/ai/auth/cloud/identity'
import { AUTH_PROVIDERS } from '@/ai/auth/registry'
import { createTokenFile } from '@/ai/auth/token-file'
import { PROVIDERS } from '@/ai/catalog'
import { LLMError } from '@/core/errors'

const REFRESH_SKEW_MS = 5 * 60_000

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

    return fetchToken === undefined ? [] : [createCloudCredentials(provider.id, fetchToken)]
  })

  return [...logins, ...identities]
}

/** Read from the file on every call, never held in memory: a logout or a login to another account
 *  takes effect on the next call, without a restart. One small file read is nothing beside the
 *  model call it authorizes. */
function createOAuthCredentials(input: OAuthCredentialsInput): CredentialSource {
  const { authProvider, tokenFile, logger } = input
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

    if (stored.expiresAt - Date.now() >= REFRESH_SKEW_MS) {
      return stored
    }

    return refresh(stored)
  }

  async function refresh(stored: StoredTokens): Promise<StoredTokens> {
    const tokens = await authProvider.refresh(stored.refreshToken)
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

/** A cloud token lives in memory only: it is minted from the operator's own credentials on demand,
 *  so there is nothing to persist, and a restart simply mints the next one. */
function createCloudCredentials(
  provider: string,
  fetchToken: () => Promise<AccessToken>
): CredentialSource {
  let cached: AccessToken | undefined
  let inFlight: Promise<AccessToken> | undefined

  return Object.freeze({
    provider,
    async authHeaders(): Promise<Readonly<Record<string, string>>> {
      if (cached === undefined || cached.expiresAt - Date.now() < REFRESH_SKEW_MS) {
        inFlight ??= fetchToken().finally(() => {
          inFlight = undefined
        })
        cached = await inFlight
      }

      return { authorization: `Bearer ${cached.accessToken}` }
    },
  })
}
