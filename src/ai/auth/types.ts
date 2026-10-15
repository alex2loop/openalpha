export interface AccessToken {
  readonly accessToken: string
  readonly expiresAt: number
}

export interface OAuthTokens extends AccessToken {
  readonly refreshToken: string
}

export interface TokenClaims {
  readonly accountId: string
  readonly planType?: string
  readonly email?: string
}

export interface StoredTokens extends OAuthTokens {
  readonly accountId: string
  readonly planType?: string
  readonly email?: string
}

// Port-independent: the callback port is only known once the listener has bound, so the URL that
// carries it is built separately by `authorizationUrl`.
export interface AuthorizationRequest {
  readonly state: string
  readonly verifier: string
}

export interface ExchangeInput {
  readonly code: string
  readonly verifier: string
  // Must be byte-identical to the one the authorization request carried.
  readonly redirectUri: string
  readonly signal?: AbortSignal
}

export interface DeviceCodePrompt {
  readonly userCode: string
  readonly verificationUrl: string
  readonly expiresAtMs: number
}

export interface DeviceCodeInput {
  onPrompt(prompt: DeviceCodePrompt): void
  // Epoch-ms, supplied by the surface that owns the login deadline.
  readonly deadline: number
  readonly signal: AbortSignal
}

// One descriptor per vendor. `id` is the catalog provider id; `loginName` is what the operator types.
// `callbackPorts` are the loopback ports the vendor has registered, in preference order — a redirect
// to an unregistered port is refused, so the listener may only fall back within this list.
// `loginWithDeviceCode` is absent for vendors that offer no device flow.
export interface AuthProvider {
  readonly id: string
  readonly loginName: string
  readonly callbackPorts: readonly number[]
  readonly callbackPath: string
  createAuthorizationRequest(): AuthorizationRequest
  authorizationUrl(request: AuthorizationRequest, port: number): string
  redirectUri(port: number): string
  exchangeCode(input: ExchangeInput): Promise<OAuthTokens>
  refresh(refreshToken: string): Promise<OAuthTokens>
  parseClaims(accessToken: string): TokenClaims | undefined
  authHeaders(tokens: StoredTokens): Readonly<Record<string, string>>
  loginWithDeviceCode?(input: DeviceCodeInput): Promise<OAuthTokens>
}

// Consumer-side: the transport declares the headers it needs. `provider` is the catalog id this
// source authenticates, so the chain can never hand one provider another's tokens. No `signal`
// parameter: the token refresh behind this call is single-flight and shared across every concurrent
// turn on the provider (see `createOAuthCredentials`), so one turn's cancellation must never abort
// another turn's in-flight refresh.
export interface CredentialSource {
  readonly provider: string
  authHeaders(): Promise<Readonly<Record<string, string>>>
}
