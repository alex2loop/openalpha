import { z } from 'zod'

import type { ChannelErrorCode } from '@/core/errors'
import { abortError, ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_SECOND } from '@/core/utils/time'

export const ZALO_API_BASE = 'https://bot-api.zaloplatforms.com'
export const ZALO_MAX_LEN = 2_000
export const ZALO_LONG_POLL_TIMEOUT_SEC = 30
// Zalo's own error table: 401 is an expired or invalid token, and 403 is listed as a server error.
export const ZALO_UNAUTHORIZED_CODE = 401
const ZALO_REQUEST_TIMEOUT_MS = 15_000
const ZALO_LONG_POLL_GRACE_MS = 5_000
const EPOCH_MS_MIN = 1_000_000_000_000

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const zaloMessageSchema = z.object({
  message_id: z.union([z.string(), z.number()]),
  from: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    display_name: z.string().optional(),
  }),
  chat: z.object({
    id: z.union([z.string(), z.number()]),
    chat_type: z.enum(['PRIVATE', 'GROUP']).optional(),
  }),
  date: z.number(),
  text: z.string().optional(),
  caption: z.string().optional(),
})

const zaloEventSchema = z.object({
  event_name: z.string(),
  message: zaloMessageSchema.optional(),
})

const zaloBotInfoSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
})

function zaloResponseSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({
    ok: z.boolean(),
    result: resultSchema.optional(),
    error_code: z.number().optional(),
    description: z.string().optional(),
  })
}

const ZALO_ME_RESPONSE_SCHEMA = zaloResponseSchema(zaloBotInfoSchema)
const ZALO_UPDATES_RESPONSE_SCHEMA = zaloResponseSchema(zaloEventSchema)
const ZALO_MESSAGE_RESPONSE_SCHEMA = zaloResponseSchema(zaloMessageSchema)
const ZALO_BOOL_RESPONSE_SCHEMA = zaloResponseSchema(z.boolean())
const ZALO_ANY_RESPONSE_SCHEMA = zaloResponseSchema(z.unknown())

type ZaloMessage = z.infer<typeof zaloMessageSchema>
export type ZaloEvent = z.infer<typeof zaloEventSchema>
type ZaloBotInfo = z.infer<typeof zaloBotInfoSchema>

export interface ZaloApiResponse<T> {
  readonly ok: boolean
  readonly result?: T
  readonly error_code?: number
  readonly description?: string
}

interface ZaloRequestOptions {
  readonly method: string
  readonly token: string
  readonly body?: Record<string, unknown>
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchFn
  readonly timeoutMs?: number
}

interface ZaloTransportOptions {
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchFn
}

interface ZaloTokenOptions extends ZaloTransportOptions {
  readonly token: string
}

interface ZaloWireResponse<T> {
  readonly ok: boolean
  readonly result?: T | undefined
  readonly error_code?: number | undefined
  readonly description?: string | undefined
}

const buildZaloUrl = (token: string, method: string): string =>
  `${ZALO_API_BASE}/bot${encodeURIComponent(token)}/${method}`

async function postZalo(options: ZaloRequestOptions): Promise<{ status: number; json: unknown }> {
  if (options.signal?.aborted) {
    return Promise.reject(abortError(options.signal))
  }

  const url = buildZaloUrl(options.token, options.method)
  const fetcher = options.fetchImpl ?? fetch

  // Compose the caller's shutdown signal with a hard request deadline; clear the timer so a finished
  // request does not keep the process alive until the timeout would have fired.
  const timeoutMs = options.timeoutMs ?? ZALO_REQUEST_TIMEOUT_MS
  const timeout = new AbortController()
  const timeoutTimer = setTimeout(() => timeout.abort(), timeoutMs)
  const onCallerAbort = (): void => clearTimeout(timeoutTimer)
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const signal =
    options.signal === undefined
      ? timeout.signal
      : AbortSignal.any([options.signal, timeout.signal])

  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : null,
      signal,
    })

    if (!res.ok) {
      const description = await res.text().catch(() => '')
      return { status: res.status, json: { ok: false, error_code: res.status, description } }
    }

    return { status: res.status, json: await res.json().catch(() => undefined) }
  } finally {
    clearTimeout(timeoutTimer)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}

// Each endpoint reports the ChannelErrorCode that fits it.
async function callZalo<S extends z.ZodTypeAny>(
  schema: S,
  errorCode: ChannelErrorCode,
  reqOpts: ZaloRequestOptions
): Promise<z.infer<S>> {
  let raw: { status: number; json: unknown }
  try {
    raw = await postZalo(reqOpts)
  } catch (err: unknown) {
    if (reqOpts.signal?.aborted) {
      throw abortError(reqOpts.signal)
    }
    throw new ChannelError(errorCode, `zalo_network_error: ${formatErrForLog(err).message}`, {
      cause: err,
    })
  }

  const parsed = schema.safeParse(raw.json)

  if (!parsed.success) {
    throw new ChannelError(errorCode, `zalo_invalid_response_shape (status ${raw.status})`)
  }

  return parsed.data
}

export async function getMe(options: ZaloTokenOptions): Promise<ZaloApiResponse<ZaloBotInfo>> {
  const response = await callZalo(ZALO_ME_RESPONSE_SCHEMA, 'not_initialized', {
    method: 'getMe',
    token: options.token,
    ...toZaloTransportOptions(options),
  })
  return toZaloApiResponse(response)
}

// Polling and a webhook are mutually exclusive on Zalo: getUpdates answers nothing while one is set.
export async function deleteWebhook(options: ZaloTokenOptions): Promise<ZaloApiResponse<unknown>> {
  const response = await callZalo(ZALO_ANY_RESPONSE_SCHEMA, 'not_initialized', {
    method: 'deleteWebhook',
    token: options.token,
    ...toZaloTransportOptions(options),
  })
  return toZaloApiResponse(response)
}

interface GetUpdatesOptions {
  readonly token: string
  readonly timeoutSec?: number
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchFn
}

export async function getUpdates(options: GetUpdatesOptions): Promise<ZaloApiResponse<ZaloEvent>> {
  const timeoutSec = options.timeoutSec ?? ZALO_LONG_POLL_TIMEOUT_SEC
  const response = await callZalo(ZALO_UPDATES_RESPONSE_SCHEMA, 'get_updates_failed', {
    method: 'getUpdates',
    token: options.token,
    // The Bot API documents `timeout` as a string of seconds.
    body: { timeout: String(timeoutSec) },
    ...toZaloTransportOptions(options),
    // The long-poll must outlive its server-side wait by the grace margin, or it self-aborts mid-idle.
    timeoutMs: timeoutSec * MS_PER_SECOND + ZALO_LONG_POLL_GRACE_MS,
  })
  return toZaloApiResponse(response)
}

interface SendZaloMessageOptions {
  readonly token: string
  readonly chatId: string
  readonly text: string
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchFn
}

export async function sendMessage(
  options: SendZaloMessageOptions
): Promise<ZaloApiResponse<ZaloMessage>> {
  const response = await callZalo(ZALO_MESSAGE_RESPONSE_SCHEMA, 'send_failed', {
    method: 'sendMessage',
    token: options.token,
    body: { chat_id: options.chatId, text: options.text },
    ...toZaloTransportOptions(options),
  })
  return toZaloApiResponse(response)
}

interface SendZaloChatActionOptions {
  readonly token: string
  readonly chatId: string
  readonly action: 'typing'
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchFn
}

export async function sendChatAction(
  options: SendZaloChatActionOptions
): Promise<ZaloApiResponse<boolean>> {
  const response = await callZalo(ZALO_BOOL_RESPONSE_SCHEMA, 'send_failed', {
    method: 'sendChatAction',
    token: options.token,
    body: { chat_id: options.chatId, action: options.action },
    ...toZaloTransportOptions(options),
  })
  return toZaloApiResponse(response)
}

function toZaloTransportOptions(options: ZaloTransportOptions): ZaloTransportOptions {
  return {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  }
}

function toZaloApiResponse<T>(response: ZaloWireResponse<T>): ZaloApiResponse<T> {
  return {
    ok: response.ok,
    ...(response.result === undefined ? {} : { result: response.result }),
    ...(response.error_code === undefined ? {} : { error_code: response.error_code }),
    ...(response.description === undefined ? {} : { description: response.description }),
  }
}

// Zalo publishes a 13-digit epoch-millisecond `date` in webhook examples and the linked SDK.
// Multiply only when a seconds field is explicitly observed.
export function toEpochMs(rawDate: number): number {
  if (!Number.isFinite(rawDate) || rawDate <= 0) {
    throw new ChannelError('get_updates_failed', `zalo_invalid_date: ${String(rawDate)}`)
  }

  const ms = rawDate >= EPOCH_MS_MIN ? rawDate : rawDate * MS_PER_SECOND

  if (!Number.isSafeInteger(ms)) {
    throw new ChannelError('get_updates_failed', `zalo_date_out_of_range: ${String(rawDate)}`)
  }

  return ms
}
