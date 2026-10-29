import type { ChannelMenuAudience, ChannelMenuCommand } from '@/channels/types'

import { postAndLog, type TelegramApiContext } from './client'
import { TELEGRAM_CMD_DESC_MAX_LEN, TELEGRAM_CMD_MAX_COUNT, TELEGRAM_CMD_MAX_LEN } from './protocol'

// Wire shape of Telegram's BotCommandScope; snake_case because it is posted verbatim.
type TelegramCommandScope =
  | { readonly type: 'default' }
  | { readonly type: 'all_private_chats' }
  | { readonly type: 'chat'; readonly chat_id: string }

// Telegram stores one list per scope and serves the narrowest that has one, so each audience is
// published independently.
export async function publishCommandMenu(
  ctx: TelegramApiContext,
  audience: ChannelMenuAudience,
  commands: readonly ChannelMenuCommand[]
): Promise<void> {
  for (const scope of toCommandScopes(audience)) {
    await setMyCommands(ctx, commands, scope)
  }
}

function toCommandScopes(audience: ChannelMenuAudience): readonly TelegramCommandScope[] {
  switch (audience.kind) {
    case 'everyone':
      return [{ type: 'default' }]
    case 'directChats':
      return [{ type: 'all_private_chats' }]
    case 'chats':
      return audience.chatIds.map((chatId) => ({ type: 'chat', chat_id: chatId }))
  }
}

// Publishes only within-limit, deduplicated commands. An oversized or malformed entry is dropped
// (never thrown) so a bad plugin description cannot break startup.
async function setMyCommands(
  ctx: TelegramApiContext,
  commands: readonly ChannelMenuCommand[],
  scope: TelegramCommandScope
): Promise<void> {
  await postAndLog(ctx, {
    method: 'setMyCommands',
    body: { commands: filterCommandsForMenu(commands), scope },
    logKey: 'telegram.set_my_commands_failed',
    level: 'warn',
    signal: ctx.intakeSignal,
  })
}

// Telegram rejects names >32 chars and descriptions >256; drop the offender, not the whole batch.
function filterCommandsForMenu(
  commands: readonly ChannelMenuCommand[]
): readonly { readonly command: string; readonly description: string }[] {
  const seen = new Set<string>()
  const payload: { command: string; description: string }[] = []

  for (const cmd of commands) {
    if (cmd.name.length < 1 || cmd.name.length > TELEGRAM_CMD_MAX_LEN) {
      continue
    }
    if (cmd.description.length < 1 || cmd.description.length > TELEGRAM_CMD_DESC_MAX_LEN) {
      continue
    }
    if (seen.has(cmd.name)) {
      continue
    }
    seen.add(cmd.name)
    payload.push({ command: cmd.name, description: cmd.description })
    if (payload.length >= TELEGRAM_CMD_MAX_COUNT) {
      break
    }
  }

  return payload
}
