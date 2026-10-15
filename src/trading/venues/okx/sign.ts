import { createHmac } from 'node:crypto'

const SIMULATED_HEADER = 'x-simulated-trading'
const JSON_CONTENT_TYPE = 'application/json'

export interface OkxCredentials {
  readonly apiKey: string
  readonly secret: string
  readonly passphrase: string
  readonly simulated: boolean
}

interface SignInput {
  readonly credentials: OkxCredentials
  readonly method: string
  /** Path including its query string: OKX signs what it receives. */
  readonly requestPath: string
  /** The exact string that will be sent, empty for a bodyless request. */
  readonly body: string
  readonly now: number
}

/** OKX signs `timestamp + METHOD + requestPath + body` and wants the digest base64-encoded, with
 *  the timestamp in ISO-8601 to millisecond precision — not the Unix ms its own time endpoint
 *  returns. Four ways to get this wrong return the same signature error and none says which. */
export function signOkxRequest(input: SignInput): Record<string, string> {
  const timestamp = new Date(input.now).toISOString()
  const preHash = `${timestamp}${input.method.toUpperCase()}${input.requestPath}${input.body}`
  const signature = createHmac('sha256', input.credentials.secret).update(preHash).digest('base64')
  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': input.credentials.apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': input.credentials.passphrase,
    'Content-Type': JSON_CONTENT_TYPE,
  }

  if (input.credentials.simulated) {
    headers[SIMULATED_HEADER] = '1'
  }

  return headers
}
