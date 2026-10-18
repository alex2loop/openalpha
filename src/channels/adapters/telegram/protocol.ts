import { z } from 'zod'

import type {
  ChannelCallbackQuery,
  InboundMessage,
  InboundReply,
  OutboundButton,
} from '@/channels/types'
import { toPastedContent } from '@/channels/pasted-content'
import { HELP_COMMAND } from '@/commands/api'
import { MS_PER_SECOND } from '@/core/utils/time'

import { TELEGRAM_CHANNEL_ID } from './config'

export const TELEGRAM_API_BASE = 'https://api.telegram.org'
export const TELEGRAM_MAX_LEN = 4096

// Telegram Bot API setMyCommands limits.
/** What Telegram accepts as `callback_data`. A payload past it is refused by the API, so a button
 *  that would not fit is rendered as a text line instead. */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64
export const TELEGRAM_CMD_MAX_LEN = 32
export const TELEGRAM_CMD_DESC_MAX_LEN = 256
export const TELEGRAM_CMD_MAX_COUNT = 100

const GROUP_CHAT_TYPES: ReadonlySet<string> = new Set(['group', 'supergroup'])
const MENTION_ENTITY_TYPE = 'mention'
const COMMAND_PREFIX = '/'
const COMMAND_HEAD_RE = /^\/([a-zA-Z0-9_]{1,32})(?:@([a-zA-Z0-9_]+))?(?:\s|$)/i
// Telegram sends this itself when someone first opens the bot. No command owns the name, so it opens
// the help rather than an unknown-command reply.
const BOT_OPENED_COMMAND = 'start'

const telegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
})

const telegramEntitySchema = z.object({
  type: z.string(),
  offset: z.number(),
  length: z.number(),
  // Present on `text_mention` entities: the actual user being named, which is the reliable
  // identity check (a display name can be spoofed, the user id cannot).
  user: z.object({ id: z.number() }).optional(),
})

const telegramChatSchema = z.object({
  id: z.number(),
  type: z.string().optional(),
})

const telegramMessageSchema = z.object({
  message_id: z.number(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z.array(telegramEntitySchema).optional(),
  reply_to_message: z
    .object({
      message_id: z.number(),
      from: telegramUserSchema.optional(),
      text: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
  // The part of the replied message the operator selected.
  quote: z.object({ text: z.string() }).optional(),
  forward_origin: z.object({ type: z.string() }).optional(),
  date: z.number(),
})

type TelegramMessage = z.infer<typeof telegramMessageSchema>

const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: telegramUserSchema,
  data: z.string().optional(),
  message: z.object({ message_id: z.number(), chat: telegramChatSchema }).optional(),
})

type TelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>

const telegramUpdateSchema = z
  .object({
    update_id: z.number(),
    message: telegramMessageSchema.optional(),
    callback_query: telegramCallbackQuerySchema.optional(),
  })
  .passthrough()

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>

// The bot's verified identity from getMe. The id is the only spoof-proof handle; username is a
// convenience for `@name` matching. Absent identity means we cannot judge a mention, so a group
// message that is not a command is not addressed (fail closed).
export interface BotIdentity {
  readonly id: number
  readonly username?: string
}

export const getUpdatesResponseSchema = z.object({
  ok: z.boolean(),
  result: z.array(telegramUpdateSchema),
})

export const sendMessageResponseSchema = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.number() }).nullable(),
})

export const getMeResponseSchema = z.object({
  ok: z.boolean(),
  result: z.object({ id: z.number(), username: z.string().optional() }).nullable(),
})

// 429 body: { ok:false, error_code:429, parameters:{ retry_after: <seconds> } }.
export const telegramRetryAfterSchema = z
  .object({ parameters: z.object({ retry_after: z.number() }).optional() })
  .passthrough()

export function buildTelegramUrl(botToken: string, method: string): string {
  return new URL(`/bot${encodeURIComponent(botToken)}/${method}`, TELEGRAM_API_BASE).toString()
}

// Flat button list -> one button per row.
export function toReplyMarkup(buttons: readonly OutboundButton[]): {
  inline_keyboard: { text: string; callback_data: string }[][]
} {
  return {
    inline_keyboard: buttons.map((button) => [
      { text: button.label, callback_data: button.callbackId },
    ]),
  }
}

export function parseUpdate(
  update: TelegramUpdate,
  identity?: BotIdentity
): { msg?: InboundMessage; cq?: ChannelCallbackQuery } {
  if (update.message) {
    return parseMessage(update.message, identity)
  }

  if (update.callback_query) {
    return { cq: parseCallbackQuery(update.callback_query) }
  }

  return {}
}

function parseMessage(
  m: TelegramMessage,
  identity: BotIdentity | undefined
): { msg?: InboundMessage } {
  // Media-only messages are skipped: an empty string would reach the LLM as a blank turn.
  const text = m.text ?? m.caption ?? ''

  if (!text) {
    return {}
  }

  const isGroup = m.chat.type !== undefined && GROUP_CHAT_TYPES.has(m.chat.type)
  // Direct chats only: sent messages are remembered per chat, not per user, so a group reply could
  // pull another member's answer into this session.
  const replyTo = isGroup ? undefined : toReplyTo(m, identity)

  return {
    msg: {
      channel: TELEGRAM_CHANNEL_ID,
      chatId: String(m.chat.id),
      userId: String(m.from?.id ?? m.chat.id),
      text: m.forward_origin === undefined ? toCommandText(text) : toPastedContent(text),
      messageId: String(m.message_id),
      receivedAt: m.date * MS_PER_SECOND,
      isGroup,
      addressedToBot: isGroup ? isAddressedToBot(m, text, identity) : true,
      ...(replyTo === undefined ? {} : { replyTo }),
    },
  }
}

function toReplyTo(
  m: TelegramMessage,
  identity: BotIdentity | undefined
): InboundReply | undefined {
  const replied = m.reply_to_message

  if (identity === undefined || replied === undefined) {
    return undefined
  }

  if (replied.from?.id !== identity.id) {
    return undefined
  }

  const text = replied.text ?? replied.caption

  return {
    messageId: String(replied.message_id),
    ...(text === undefined ? {} : { text }),
    ...(m.quote === undefined ? {} : { quote: m.quote.text }),
  }
}

function toCommandText(text: string): string {
  return parseCommandHead(text)?.name.toLowerCase() === BOT_OPENED_COMMAND ? HELP_COMMAND : text
}

// A command is always addressed if unqualified; a qualified command is addressed only when the
// optional @target matches the verified bot username. Fail closed without a verified identity.
function isAddressedToBot(
  m: TelegramMessage,
  text: string,
  identity: BotIdentity | undefined
): boolean {
  if (text.startsWith(COMMAND_PREFIX)) {
    return isCommandAddressed(text, identity)
  }

  // Fail closed: without a verified identity we cannot confirm a mention, so a group message that
  // is not a command is left unaddressed rather than blindly accepted.
  if (identity === undefined) {
    return false
  }

  if (m.reply_to_message?.from?.id === identity.id) {
    return true
  }

  return (m.entities ?? []).some((entity) => {
    if (entity.type === MENTION_ENTITY_TYPE) {
      const handle = `@${identity.username?.toLowerCase() ?? ''}`

      return (
        identity.username !== undefined &&
        text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === handle
      )
    }

    if (entity.type === 'text_mention' && entity.user?.id === identity.id) {
      return true
    }

    return false
  })
}

interface CommandHead {
  readonly name: string
  readonly target?: string
}

// Telegram's optional @bot suffix is only accepted when the verified username is known and matches
// case-insensitively. Malformed command heads are treated as unaddressed (fail closed in groups).
function parseCommandHead(text: string): CommandHead | undefined {
  const match = COMMAND_HEAD_RE.exec(text)

  if (!match) {
    return undefined
  }

  const name = match[1]
  const target = match[2]

  if (name === undefined) {
    return undefined
  }

  if (target === undefined) {
    return { name }
  }

  return { name, target }
}

function isCommandAddressed(text: string, identity: BotIdentity | undefined): boolean {
  const command = parseCommandHead(text)

  if (command === undefined) {
    return false
  }

  if (command.target === undefined) {
    return true
  }

  return (
    identity?.username !== undefined &&
    command.target.toLowerCase() === identity.username.toLowerCase()
  )
}

function parseCallbackQuery(cq: TelegramCallbackQuery): ChannelCallbackQuery {
  const base = {
    channel: TELEGRAM_CHANNEL_ID,
    id: cq.id,
    data: cq.data ?? '',
    from: String(cq.from.id),
  }

  if (!cq.message) {
    return base
  }

  const isGroup = cq.message.chat.type !== undefined && GROUP_CHAT_TYPES.has(cq.message.chat.type)

  return {
    ...base,
    messageId: String(cq.message.message_id),
    chatId: String(cq.message.chat.id),
    ...(isGroup ? { isGroup: true } : {}),
  }
}
