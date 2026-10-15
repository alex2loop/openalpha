import { readRecord, readString } from '@/ai/auth/json'
import { abortError, LLMError } from '@/core/errors'
import { HttpRequestError, httpRequest } from '@/core/http-client'
import { MS_PER_SECOND } from '@/core/utils/time'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_BYTES = 65_536
const POLL_MIN_INTERVAL_MS = 1_000
const POLL_DEFAULT_INTERVAL_MS = 5_000
const PENDING_STATUSES: ReadonlySet<number> = new Set([403, 404])

interface DeviceAuthorization {
  readonly code: string
  readonly verifier: string
}

interface PollDeviceCodeInput {
  readonly host: string
  readonly userCodePath: string
  readonly tokenPath: string
  readonly body: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
  readonly verificationUrl: string
  readonly deadline: number
  onPrompt(prompt: { userCode: string; verificationUrl: string; expiresAtMs: number }): void
  readonly signal: AbortSignal
}

export async function pollDeviceCode(input: PollDeviceCodeInput): Promise<DeviceAuthorization> {
  const started = await requestUserCode(input)

  input.onPrompt({
    userCode: started.userCode,
    verificationUrl: input.verificationUrl,
    expiresAtMs: input.deadline,
  })

  for (;;) {
    if (input.signal.aborted) {
      throw abortError(input.signal)
    }
    if (Date.now() > input.deadline) {
      throw new LLMError('auth', 'device login expired before approval')
    }

    const authorization = await tryFetchAuthorization(input, started)

    if (authorization !== undefined) {
      return authorization
    }

    await delay(started.intervalMs, input.signal)
  }
}

interface StartedLogin {
  readonly deviceAuthId: string
  readonly userCode: string
  readonly intervalMs: number
}

async function requestUserCode(input: PollDeviceCodeInput): Promise<StartedLogin> {
  const text = await postJson(input, input.userCodePath, input.body)
  const json = readRecord(JSON.parse(text))
  const deviceAuthId = readString(json?.device_auth_id)
  const userCode = readString(json?.user_code) ?? readString(json?.usercode)

  if (deviceAuthId === undefined || userCode === undefined) {
    throw new LLMError('auth', 'device login did not return a user code')
  }

  const interval =
    typeof json?.interval === 'number' ? json.interval * MS_PER_SECOND : POLL_DEFAULT_INTERVAL_MS

  return { deviceAuthId, userCode, intervalMs: Math.max(POLL_MIN_INTERVAL_MS, interval) }
}

// The shared fixed-host client discards non-2xx bodies, so status is all there is to read: an
// approval still pending answers 403 and an unrecognized device auth 404, while a transport failure
// carries no status at all and deserves another poll. Every other status is a real failure and must
// surface immediately rather than being masked as pending approval.
async function tryFetchAuthorization(
  input: PollDeviceCodeInput,
  started: StartedLogin
): Promise<DeviceAuthorization | undefined> {
  try {
    const text = await postJson(input, input.tokenPath, {
      ...input.body,
      device_auth_id: started.deviceAuthId,
      user_code: started.userCode,
    })
    const json = readRecord(JSON.parse(text))
    const code = readString(json?.authorization_code)
    const verifier = readString(json?.code_verifier)

    return code === undefined || verifier === undefined ? undefined : { code, verifier }
  } catch (err: unknown) {
    if (!(err instanceof HttpRequestError)) {
      throw err
    }

    if (err.status !== undefined && !PENDING_STATUSES.has(err.status)) {
      throw new LLMError('auth', `device login failed (HTTP ${err.status})`, { cause: err })
    }

    return undefined
  }
}

async function postJson(
  input: PollDeviceCodeInput,
  path: string,
  body: Readonly<Record<string, string>>
): Promise<string> {
  const response = await httpRequest({
    hosts: [input.host],
    path,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...input.headers },
    body: JSON.stringify(body),
    maxBytes: MAX_BYTES,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal: input.signal,
  })

  return response.text
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError(signal))
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
