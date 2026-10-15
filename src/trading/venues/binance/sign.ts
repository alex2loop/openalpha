import { createHmac } from 'node:crypto'

const API_KEY_HEADER = 'X-MBX-APIKEY'

/** Binance's default and its recommended ceiling. */
export const RECEIVE_WINDOW_MS = 5_000

export interface BinanceCredentials {
  readonly apiKey: string
  readonly secret: string
  readonly simulated: boolean
}

interface SignInput {
  readonly credentials: BinanceCredentials
  readonly params: Readonly<Record<string, string>>
  readonly now: number
}

interface SignedQuery {
  readonly query: Record<string, string>
  readonly headers: Record<string, string>
}

/** Binance signs the query string exactly as sent. The signature goes last, and the URL keeps the
 *  insertion order the digest was taken over, so the two cannot disagree. */
export function signBinanceQuery(input: SignInput): SignedQuery {
  const query: Record<string, string> = {
    ...input.params,
    timestamp: String(input.now),
    recvWindow: String(RECEIVE_WINDOW_MS),
  }
  const payload = new URLSearchParams(query).toString()
  const signature = createHmac('sha256', input.credentials.secret).update(payload).digest('hex')

  return {
    query: { ...query, signature },
    headers: { [API_KEY_HEADER]: input.credentials.apiKey },
  }
}
