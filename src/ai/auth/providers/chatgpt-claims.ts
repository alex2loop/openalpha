import type { TokenClaims } from '@/ai/auth/types'
import { readRecord, readString } from '@/ai/auth/json'

const AUTH_CLAIM = 'https://api.openai.com/auth'
const PROFILE_CLAIM = 'https://api.openai.com/profile'
const JWT_PARTS = 3
const PAYLOAD_INDEX = 1

export function parseChatgptClaims(accessToken: string): TokenClaims | undefined {
  const payload = decodePayload(accessToken)
  const auth = readRecord(payload?.[AUTH_CLAIM])
  const accountId = readString(auth?.chatgpt_account_id)

  if (accountId === undefined) {
    return undefined
  }

  const planType = readString(auth?.chatgpt_plan_type)
  const email = readString(readRecord(payload?.[PROFILE_CLAIM])?.email)

  return {
    accountId,
    ...(planType === undefined ? {} : { planType }),
    ...(email === undefined ? {} : { email }),
  }
}

function decodePayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')

  if (parts.length !== JWT_PARTS) {
    return undefined
  }

  try {
    return readRecord(
      JSON.parse(Buffer.from(parts[PAYLOAD_INDEX] ?? '', 'base64url').toString('utf8'))
    )
  } catch {
    // A payload that is not JSON carries no claims; the caller treats that as a failed login.
    return undefined
  }
}
