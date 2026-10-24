import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { AccessToken } from '@/ai/auth/types'
import { readRecord, readString } from '@/ai/auth/json'
import { requestAccessToken } from '@/ai/auth/token-request'
import { LLMError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'

const ISSUER = 'Google'
export const GOOGLE_TOKEN_HOST = 'https://oauth2.googleapis.com'
const TOKEN_PATH = '/token'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const ASSERTION_LIFETIME_S = 3600
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

/** Signs in with the credentials file `GOOGLE_APPLICATION_CREDENTIALS` names: a service account
 *  key, or the user login `gcloud auth application-default login` writes. The token endpoint is
 *  fixed here, never read from the file. */
export async function fetchGoogleToken(credentialsPath: string): Promise<AccessToken> {
  const key = await readCredentials(credentialsPath)

  return await requestAccessToken({
    issuer: ISSUER,
    host: GOOGLE_TOKEN_HOST,
    path: TOKEN_PATH,
    form: toGrant(key),
  })
}

async function readCredentials(path: string): Promise<Record<string, unknown>> {
  try {
    const key = readRecord(JSON.parse(await readFile(path, 'utf8')))

    if (key !== undefined) {
      return key
    }
  } catch (err: unknown) {
    throw new LLMError('auth', 'cannot read the Google credentials file', { cause: err })
  }

  throw new LLMError('auth', 'the Google credentials file is not a JSON object')
}

function toGrant(key: Record<string, unknown>): Readonly<Record<string, string>> {
  if (key.type === 'service_account') {
    return { grant_type: JWT_BEARER_GRANT, assertion: signAssertion(key) }
  }

  const clientId = readString(key.client_id)
  const clientSecret = readString(key.client_secret)
  const refreshToken = readString(key.refresh_token)

  if (
    key.type !== 'authorized_user' ||
    clientId === undefined ||
    clientSecret === undefined ||
    refreshToken === undefined
  ) {
    throw new LLMError(
      'auth',
      'the Google credentials file is neither a service account nor a login'
    )
  }

  return {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }
}

function signAssertion(key: Record<string, unknown>): string {
  const email = readString(key.client_email)
  const privateKey = readString(key.private_key)

  if (email === undefined || privateKey === undefined) {
    throw new LLMError('auth', 'the Google service account key lacks its email or private key')
  }

  const issuedAt = Math.floor(Date.now() / MS_PER_SECOND)
  const header = toSegment({ alg: 'RS256', typ: 'JWT' })
  const claims = toSegment({
    iss: email,
    scope: SCOPE,
    aud: `${GOOGLE_TOKEN_HOST}${TOKEN_PATH}`,
    iat: issuedAt,
    exp: issuedAt + ASSERTION_LIFETIME_S,
  })
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(privateKey, 'base64url')

  return `${header}.${claims}.${signature}`
}

function toSegment(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
