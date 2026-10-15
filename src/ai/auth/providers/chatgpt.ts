import { createHash, randomBytes } from 'node:crypto'

import type {
  AuthorizationRequest,
  AuthProvider,
  DeviceCodeInput,
  ExchangeInput,
  OAuthTokens,
  StoredTokens,
} from '@/ai/auth/types'
import { attributionHeaders } from '@/ai/auth/attribution'
import { readRecord, readString } from '@/ai/auth/json'
import { parseChatgptClaims } from '@/ai/auth/providers/chatgpt-claims'
import { pollDeviceCode } from '@/ai/auth/providers/device-code'
import { TOKEN_MAX_BYTES, TOKEN_TIMEOUT_MS, toTokenRequestError } from '@/ai/auth/token-request'
import { BRAND } from '@/core/brand'
import { isAbortError, LLMError } from '@/core/errors'
import { httpRequest } from '@/core/http-client'
import { MS_PER_SECOND } from '@/core/utils/time'

export const CHATGPT_PROVIDER_ID = 'openai-chatgpt'

const LOGIN_NAME = 'chatgpt'
const OAUTH_HOST = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_PATH = '/oauth/authorize'
const TOKEN_PATH = '/oauth/token'
const USERCODE_PATH = '/api/accounts/deviceauth/usercode'
const DEVICE_TOKEN_PATH = '/api/accounts/deviceauth/token'
const DEVICE_REDIRECT_URI = `${OAUTH_HOST}/deviceauth/callback`
const VERIFICATION_URL = `${OAUTH_HOST}/deviceauth`
// Both are registered with the OAuth app; the second is what the official client falls back to when
// the first is taken. `localhost` rather than the loopback literal, because that is what is
// registered — RFC 8252 prefers the literal, but an unregistered redirect is refused outright.
const CALLBACK_PORTS = [1455, 1457] as const
const CALLBACK_PATH = '/auth/callback'
const SCOPE = 'openid profile email offline_access'
const ACCOUNT_HEADER = 'chatgpt-account-id'
const STATE_BYTES = 16
const VERIFIER_BYTES = 32

export const chatgptAuthProvider: AuthProvider = Object.freeze({
  id: CHATGPT_PROVIDER_ID,
  loginName: LOGIN_NAME,
  callbackPorts: CALLBACK_PORTS,
  callbackPath: CALLBACK_PATH,
  parseClaims: parseChatgptClaims,

  createAuthorizationRequest(): AuthorizationRequest {
    return {
      state: randomBytes(STATE_BYTES).toString('hex'),
      verifier: randomBytes(VERIFIER_BYTES).toString('base64url'),
    }
  },

  redirectUri,

  authorizationUrl(request: AuthorizationRequest, port: number): string {
    const url = new URL(`${OAUTH_HOST}${AUTHORIZE_PATH}`)

    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('redirect_uri', redirectUri(port))
    url.searchParams.set('scope', SCOPE)
    url.searchParams.set('code_challenge', challengeOf(request.verifier))
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', request.state)
    url.searchParams.set('id_token_add_organizations', 'true')
    url.searchParams.set('codex_cli_simplified_flow', 'true')
    url.searchParams.set('originator', BRAND.name)

    return url.toString()
  },

  exchangeCode: exchangeChatgptCode,

  // No signal: one refresh is shared by every concurrent turn, so no single caller may cancel it.
  async refresh(refreshToken: string): Promise<OAuthTokens> {
    return await postTokenForm(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      })
    )
  },

  authHeaders(tokens: StoredTokens): Readonly<Record<string, string>> {
    return {
      authorization: `Bearer ${tokens.accessToken}`,
      [ACCOUNT_HEADER]: tokens.accountId,
    }
  },

  async loginWithDeviceCode(input: DeviceCodeInput): Promise<OAuthTokens> {
    const authorization = await pollDeviceCode({
      host: OAUTH_HOST,
      userCodePath: USERCODE_PATH,
      tokenPath: DEVICE_TOKEN_PATH,
      body: { client_id: CLIENT_ID },
      headers: attributionHeaders(),
      verificationUrl: VERIFICATION_URL,
      deadline: input.deadline,
      onPrompt: input.onPrompt,
      signal: input.signal,
    })

    return await exchangeChatgptCode({
      code: authorization.code,
      verifier: authorization.verifier,
      redirectUri: DEVICE_REDIRECT_URI,
      signal: input.signal,
    })
  },
})

function redirectUri(port: number): string {
  return `http://localhost:${port}${CALLBACK_PATH}`
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// The token exchange must repeat the exact `redirect_uri` the authorization used, so the caller
// passes back the one it logged in with rather than rebuilding a default here.
async function exchangeChatgptCode(input: ExchangeInput): Promise<OAuthTokens> {
  return await postTokenForm(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
    }),
    input.signal
  )
}

async function postTokenForm(body: URLSearchParams, signal?: AbortSignal): Promise<OAuthTokens> {
  try {
    const response = await httpRequest({
      hosts: [OAUTH_HOST],
      path: TOKEN_PATH,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...attributionHeaders() },
      body: body.toString(),
      maxBytes: TOKEN_MAX_BYTES,
      timeoutMs: TOKEN_TIMEOUT_MS,
      signal: signal ?? AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })

    return toTokens(response.text)
  } catch (err: unknown) {
    // The caller's abort is their own signal coming back — it is not a provider failure.
    if (isAbortError(err)) {
      throw err
    }

    throw toTokenRequestError(err, 'ChatGPT')
  }
}

function toTokens(text: string): OAuthTokens {
  const json = readRecord(JSON.parse(text))
  const accessToken = readString(json?.access_token)
  const refreshToken = readString(json?.refresh_token)
  const lifetime = json?.expires_in

  if (accessToken === undefined || refreshToken === undefined || typeof lifetime !== 'number') {
    throw new LLMError('auth', 'ChatGPT token response is missing required fields')
  }

  return { accessToken, refreshToken, expiresAt: Date.now() + lifetime * MS_PER_SECOND }
}
