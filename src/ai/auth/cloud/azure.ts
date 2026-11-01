import type { AccessToken } from '@/ai/auth/types'
import { requestAccessToken } from '@/ai/auth/token-request'
import { LLMError } from '@/core/errors'

const ISSUER = 'Azure'
export const AZURE_LOGIN_HOST = 'https://login.microsoftonline.com'
const SCOPE = 'https://cognitiveservices.azure.com/.default'
// A tenant is a GUID or a domain; anything else would steer the token path.
const TENANT_RE = /^[A-Za-z0-9.-]+$/

interface AzureServicePrincipal {
  readonly tenantId: string
  readonly clientId: string
  readonly clientSecret: string
}

/** Signs in as a Microsoft Entra service principal, the client-secret flow Azure OpenAI accepts. */
export async function fetchAzureToken(principal: AzureServicePrincipal): Promise<AccessToken> {
  if (!TENANT_RE.test(principal.tenantId)) {
    throw new LLMError('auth', 'AZURE_TENANT_ID is not a tenant id or domain')
  }

  return await requestAccessToken({
    issuer: ISSUER,
    host: AZURE_LOGIN_HOST,
    path: `/${principal.tenantId}/oauth2/v2.0/token`,
    form: {
      grant_type: 'client_credentials',
      client_id: principal.clientId,
      client_secret: principal.clientSecret,
      scope: SCOPE,
    },
  })
}
