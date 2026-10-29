import type { ChannelOutbound, EditRequest, ReactionRequest, SentRef } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import { PermanentChannelError } from '@/channels/permanent-error'
import { ChannelError, type ChannelErrorCode } from '@/core/errors'
import { BROWSER_HEADERS } from '@/core/http-client'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_SECOND } from '@/core/utils/time'

import { toPlainText } from './markup'
import {
  type BotIdentity,
  buildTelegramUrl,
  getMeResponseSchema,
  getUpdatesResponseSchema,
  sendMessageResponseSchema,
  TELEGRAM_MAX_LEN,
  type TelegramUpdate,
  telegramRetryAfterSchema,
  toReplyMarkup,
} from './protocol'

// Bounds every call, including getUpdates' own long-poll timeout.
const TELEGRAM_REQUEST_TIMEOUT_MS = 15_000
const RATE_LIMITED_STATUS = 429
const REQUEST_TIMEOUT_STATUS = 408
const BAD_REQUEST_STATUS = 400
const CLIENT_ERROR_MIN_STATUS = 400
const SERVER_ERROR_MIN_STATUS = 500
const ALLOWED_UPDATES = '["message","callback_query"]'
const MAX_ERROR_DESCRIPTION_LEN = 512
const PARSE_FAILURE_RE = /can't parse|parse error/i
const NOT_MODIFIED_RE = /message is not modified/i

type TelegramBody = Record<string, unknown> & { text: string }

export interface TelegramApiContext {
  readonly botToken: string
  readonly fetchImpl: typeof fetch
  /** Ends the polling and start-up calls. A send does not take it: delivery outlives intake, and
   *  the adapter's `dispose` is what closes it. */
  readonly intakeSignal: AbortSignal
  readonly logger: Logger
}

interface GetUpdatesOptions {
  readonly offset: number
  readonly timeoutSec: number
}

// `err.cause` carries the HTTP status for the ChannelErrors thrown below.
export function telegramErrorStatus(err: unknown): number | undefined {
  return err instanceof ChannelError && typeof err.cause === 'number' ? err.cause : undefined
}

export async function sendMessage(
  ctx: TelegramApiContext,
  out: ChannelOutbound,
  options?: { readonly signal?: AbortSignal }
): Promise<SentRef> {
  assertWithinTextLimit(out.text, 'send_failed')

  const result = await postWithPlainFallback(ctx, {
    method: 'sendMessage',
    body: buildSendBody(out, out.text),
    useMarkup: out.useMarkup === true,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  })

  if (result.kind === 'failed') {
    throw toChannelError(result.err, 'send_failed', 'sendMessage')
  }

  return parseSendResponse(result.res)
}

export async function editMessage(ctx: TelegramApiContext, req: EditRequest): Promise<void> {
  const messageId = Number(req.messageId)

  if (!(Number.isFinite(messageId) && Number.isInteger(messageId))) {
    throw new ChannelError(
      'edit_failed',
      `telegram editMessageText: invalid messageId '${req.messageId}'`
    )
  }

  assertWithinTextLimit(req.text, 'edit_failed')

  const body: TelegramBody = { chat_id: req.chatId, message_id: messageId, text: req.text }

  applyMarkup(body, req.useMarkup === true)

  if (req.buttons && req.buttons.length > 0) {
    body.reply_markup = toReplyMarkup(req.buttons)
  }

  const result = await postWithPlainFallback(ctx, {
    method: 'editMessageText',
    body,
    useMarkup: req.useMarkup === true,
    ...(req.signal === undefined ? {} : { signal: req.signal }),
  })

  // Telegram refuses an edit that changes nothing; the message already reads as asked.
  if (result.kind === 'failed' && isUnchangedEdit(result.err)) {
    return
  }

  if (result.kind === 'failed') {
    throw toChannelError(result.err, 'edit_failed', 'editMessageText')
  }

  await discardBody(result.res)
}

export async function sendChatAction(
  ctx: TelegramApiContext,
  chatId: string,
  action: 'typing'
): Promise<void> {
  await postAndLog(ctx, {
    method: 'sendChatAction',
    body: { chat_id: chatId, action },
    logKey: 'telegram.chat_action_failed',
  })
}

export async function setMessageReaction(
  ctx: TelegramApiContext,
  req: ReactionRequest
): Promise<void> {
  // `null` clears every reaction; it is not a no-op.
  const reaction = req.emoji === null ? [] : [{ type: 'emoji', emoji: req.emoji }]

  await postAndLog(ctx, {
    method: 'setMessageReaction',
    body: { chat_id: req.chatId, message_id: Number(req.messageId), reaction },
    logKey: 'telegram.set_reaction_failed',
  })
}

export async function answerCallbackQuery(
  ctx: TelegramApiContext,
  callbackQueryId: string
): Promise<void> {
  await postAndLog(ctx, {
    method: 'answerCallbackQuery',
    body: { callback_query_id: callbackQueryId },
    logKey: 'telegram.answer_callback_query_failed',
  })
}

// Clears any active webhook so getUpdates polling can start without a persistent 409 Conflict.
export async function deleteWebhook(ctx: TelegramApiContext): Promise<void> {
  await postAndLog(ctx, {
    method: 'deleteWebhook',
    body: { drop_pending_updates: false },
    logKey: 'telegram.delete_webhook_failed',
    level: 'warn',
    signal: ctx.intakeSignal,
  })
}

export async function getMe(ctx: TelegramApiContext): Promise<BotIdentity> {
  const res = await ctx.fetchImpl(buildTelegramUrl(ctx.botToken, 'getMe'), {
    headers: baseHeaders(),
    signal: withTimeout(TELEGRAM_REQUEST_TIMEOUT_MS, ctx.intakeSignal),
  })

  if (!res.ok) {
    throw await httpFailure(res, 'not_initialized', 'getMe')
  }

  const raw: unknown = await res.json().catch(() => null)
  const parsed = getMeResponseSchema.safeParse(raw)

  if (!(parsed.success && parsed.data.result)) {
    throw new ChannelError('not_initialized', 'telegram getMe returned no result')
  }

  const result = parsed.data.result

  return { id: result.id, ...(result.username === undefined ? {} : { username: result.username }) }
}

export async function getUpdates(
  ctx: TelegramApiContext,
  options: GetUpdatesOptions
): Promise<readonly TelegramUpdate[]> {
  const url = new URL(buildTelegramUrl(ctx.botToken, 'getUpdates'))
  url.searchParams.set('offset', String(options.offset))
  url.searchParams.set('timeout', String(options.timeoutSec))
  url.searchParams.set('allowed_updates', ALLOWED_UPDATES)

  const res = await ctx.fetchImpl(url.toString(), {
    headers: baseHeaders(),
    signal: withTimeout(TELEGRAM_REQUEST_TIMEOUT_MS, ctx.intakeSignal),
  })

  if (!res.ok) {
    throw await httpFailure(res, 'get_updates_failed', 'getUpdates')
  }

  const raw: unknown = await res.json().catch(() => null)
  const parsed = getUpdatesResponseSchema.safeParse(raw)

  if (!parsed.success) {
    throw new ChannelError('get_updates_failed', 'telegram getUpdates: invalid response body')
  }

  return parsed.data.result
}

// Telegram counts message length in UTF-16 code units, which is exactly JS string .length. Text is
// chunked before it reaches a transport, so anything over the limit here bypassed that — refused
// rather than cut, because a silent truncation loses the tail of a brief and reports success.
function assertWithinTextLimit(text: string, code: ChannelErrorCode): void {
  if (text.length > TELEGRAM_MAX_LEN) {
    throw new PermanentChannelError(
      code,
      `telegram text is ${text.length} code units, over the ${TELEGRAM_MAX_LEN} limit`
    )
  }
}

function buildSendBody(out: ChannelOutbound, text: string): TelegramBody {
  const body: TelegramBody = { chat_id: out.chatId, text }

  applyMarkup(body, out.useMarkup === true)

  // A deleted anchor must not fail the send: the placeholder and the answer matter more than the
  // thread they hang from.
  if (out.replyToMessageId !== undefined) {
    body.reply_parameters = {
      message_id: Number(out.replyToMessageId),
      allow_sending_without_reply: true,
    }
  }
  if (out.silent) {
    body.disable_notification = true
  }
  if (out.buttons && out.buttons.length > 0) {
    body.reply_markup = toReplyMarkup(out.buttons)
  }

  return body
}

// Sends and edits share this so a message does not gain preview cards when it is edited.
function applyMarkup(body: TelegramBody, useMarkup: boolean): void {
  if (!useMarkup) {
    return
  }

  body.parse_mode = 'MarkdownV2'
  // A citation is a headline carrying its source, so four of them would otherwise append four
  // preview cards to a message the whole plan exists to shorten.
  body.link_preview_options = { is_disabled: true }
}

async function parseSendResponse(res: Response): Promise<SentRef> {
  const raw: unknown = await res.json().catch(() => null)
  const parsed = sendMessageResponseSchema.safeParse(raw)

  if (!(parsed.success && parsed.data.result)) {
    throw new ChannelError('send_failed', 'telegram sendMessage returned no result')
  }

  return { messageId: String(parsed.data.result.message_id) }
}

function baseHeaders(): Record<string, string> {
  return { ...BROWSER_HEADERS }
}

function withTimeout(timeoutMs: number, extra?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)

  return extra === undefined ? timeout : AbortSignal.any([extra, timeout])
}

interface PostJsonRequest {
  readonly method: string
  readonly body: unknown
  readonly signal?: AbortSignal
}

async function postJson(ctx: TelegramApiContext, req: PostJsonRequest): Promise<Response> {
  return ctx.fetchImpl(buildTelegramUrl(ctx.botToken, req.method), {
    method: 'POST',
    headers: { ...baseHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(req.body),
    signal: withTimeout(TELEGRAM_REQUEST_TIMEOUT_MS, req.signal),
  })
}

interface MarkupPostRequest {
  readonly method: string
  readonly body: TelegramBody
  readonly useMarkup: boolean
  readonly signal?: AbortSignal
}

type MarkupPostResult =
  | { readonly kind: 'ok'; readonly res: Response }
  | { readonly kind: 'failed'; readonly err: TelegramApiError }

// Telegram rejects the whole message when MarkdownV2 fails to parse. Resending it unescaped and
// without `parse_mode` keeps the message flowing: a markup edge case degrades to plain text instead
// of dropping the send or freezing a live edit on its placeholder.
async function postWithPlainFallback(
  ctx: TelegramApiContext,
  req: MarkupPostRequest
): Promise<MarkupPostResult> {
  const signal = req.signal === undefined ? {} : { signal: req.signal }
  const res = await postJson(ctx, { method: req.method, body: req.body, ...signal })

  if (res.ok) {
    return { kind: 'ok', res }
  }

  const err = await readTelegramError(res)

  if (!(req.useMarkup && err.status === BAD_REQUEST_STATUS && isParseFailure(err.description))) {
    return { kind: 'failed', err }
  }

  ctx.logger.debug('telegram.markdown_parse_failed', {
    method: req.method,
    status: err.status,
    description: err.description,
  })

  const plainRes = await postJson(ctx, {
    method: req.method,
    body: { ...req.body, parse_mode: undefined, text: toPlainText(req.body.text) },
    ...signal,
  })

  return plainRes.ok
    ? { kind: 'ok', res: plainRes }
    : { kind: 'failed', err: await readTelegramError(plainRes) }
}

// 429 carries a back-off hint; surfaced as retryAfterMs so reply.ts decides whether to wait.
async function httpFailure(
  res: Response,
  code: ChannelErrorCode,
  label: string
): Promise<ChannelError> {
  return toChannelError(await readTelegramError(res), code, label)
}

function toChannelError(
  err: TelegramApiError,
  code: ChannelErrorCode,
  label: string
): ChannelError {
  if (err.status === RATE_LIMITED_STATUS) {
    const retryAfterMs = parseRetryAfterFromBody(err.body)

    return new ChannelError(code, `telegram ${label} rate-limited: ${err.description}`, {
      cause: err.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    })
  }

  const message = `telegram ${label} failed: HTTP ${err.status} ${err.description}`

  return isPermanentStatus(err.status)
    ? new PermanentChannelError(code, message, { cause: err.status })
    : new ChannelError(code, message, { cause: err.status })
}

// A client error other than a timeout or a rate limit (a bad request, a blocked bot, a revoked
// token) says the same thing on every attempt; a server error or a dropped line may not.
function isPermanentStatus(status: number): boolean {
  return (
    status >= CLIENT_ERROR_MIN_STATUS &&
    status < SERVER_ERROR_MIN_STATUS &&
    status !== REQUEST_TIMEOUT_STATUS &&
    status !== RATE_LIMITED_STATUS
  )
}

interface TelegramApiError {
  readonly status: number
  readonly description: string
  readonly body: unknown
}

async function readTelegramError(res: Response): Promise<TelegramApiError> {
  const status = res.status
  const raw: unknown = await res.json().catch(() => null)
  const description =
    typeof raw === 'object' &&
    raw !== null &&
    'description' in raw &&
    typeof raw.description === 'string'
      ? truncateString(raw.description, MAX_ERROR_DESCRIPTION_LEN)
      : ''

  return { status, description, body: raw }
}

function parseRetryAfterFromBody(body: unknown): number | undefined {
  const parsed = telegramRetryAfterSchema.safeParse(body)

  if (!(parsed.success && parsed.data.parameters)) {
    return undefined
  }

  return parsed.data.parameters.retry_after * MS_PER_SECOND
}

function isParseFailure(description: string): boolean {
  return PARSE_FAILURE_RE.test(description)
}

function isUnchangedEdit(err: TelegramApiError): boolean {
  return err.status === BAD_REQUEST_STATUS && NOT_MODIFIED_RE.test(err.description)
}

function truncateString(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

interface PostAndLogRequest {
  readonly method: string
  readonly body: unknown
  readonly logKey: string
  // `warn` for calls whose failure every user of the bot notices; per-message trivia stays debug.
  readonly level?: 'warn'
  readonly signal?: AbortSignal
}

// Posts, drains the response, and never throws: a failure is logged under the request's key and
// reported as false, not as an error path.
export async function postAndLog(
  ctx: TelegramApiContext,
  req: PostAndLogRequest
): Promise<boolean> {
  // why-safe: Logger's level methods are closures over the pino instance, never `this`-bound.
  const log = req.level === 'warn' ? ctx.logger.warn : ctx.logger.debug

  try {
    const res = await postJson(ctx, {
      method: req.method,
      body: req.body,
      ...(req.signal === undefined ? {} : { signal: req.signal }),
    })

    if (!res.ok) {
      log(req.logKey, { status: res.status })
    }

    await discardBody(res)

    return res.ok
  } catch (err: unknown) {
    log(req.logKey, { err: formatErrForLog(err) })

    return false
  }
}

// An unread body holds its connection until GC; these calls only ever need the status line.
async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined)
}
