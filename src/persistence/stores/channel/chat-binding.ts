import type { ChannelId } from '@/core/channels'
import type { ChatBinding, ChatBindingStore, ChatSessionReset } from '@/core/types/session'
import type { Dialect, Storage } from '@/core/types/storage'
import { channelId } from '@/core/channels'
import { agentId, userId } from '@/core/ids'

// One owner of the channel_state session-route namespace: routers write `session:` keys, and
// session deletion derives its cleanup pattern from this prefix. Persistence-internal only.
export const SESSION_ROUTE_KEY_PREFIX = 'session:'

const BINDING_COLS = ['agent_id', 'user_id', 'updated_at'] as const
const ROUTE_KEY_PATTERN = `${SESSION_ROUTE_KEY_PREFIX}%`

interface BindingRow {
  readonly agent_id: string
  readonly user_id: string
}

interface ListRow extends BindingRow {
  readonly channel: string
  readonly chat_id: string
}

interface SessionRouteRow {
  readonly key: string
}

export function createChatBindingStore(db: Storage, dialect: Dialect): ChatBindingStore {
  const sql = buildSql(dialect)

  return {
    async get(channel: ChannelId, chatId: string): Promise<ChatBinding | null> {
      const rows = await db.query<BindingRow>(sql.get, [channel, chatId])
      const row = rows[0]

      if (!row) {
        return null
      }

      return { channel, chatId, agentId: agentId(row.agent_id), userId: userId(row.user_id) }
    },

    async put(binding: ChatBinding): Promise<void> {
      await db.execute(sql.put, [
        binding.channel,
        binding.chatId,
        binding.agentId,
        binding.userId,
        Date.now(),
      ])
    },

    async remove(channel: ChannelId, chatId: string): Promise<void> {
      await db.execute(sql.remove, [channel, chatId])
    },

    resetSession: (reset) => resetSession(db, sql, reset),

    async list(): Promise<readonly ChatBinding[]> {
      const rows = await db.query<ListRow>(sql.list)

      return rows.map((row) => ({
        channel: channelId(row.channel),
        chatId: row.chat_id,
        agentId: agentId(row.agent_id),
        userId: userId(row.user_id),
      }))
    },
  }
}

async function resetSession(
  db: Storage,
  sql: ReturnType<typeof buildSql>,
  reset: ChatSessionReset
): Promise<void> {
  const now = Date.now()
  const sessionKey = sessionRouteKey(reset.chatId, reset.userId)

  await db.transaction(async (tx) => {
    const routes = await tx.query<SessionRouteRow>(sql.listSessionRoutes, [
      reset.channel,
      reset.channel,
      reset.chatId,
      ROUTE_KEY_PATTERN,
    ])
    const keys = new Set([sessionKey, ...routes.map((route) => route.key)])

    for (const key of keys) {
      await tx.execute(sql.removeSessionRoute, [reset.channel, key])
    }

    if (reset.agentId === undefined) {
      await tx.execute(sql.remove, [reset.channel, reset.chatId])
      return
    }

    await tx.execute(sql.put, [reset.channel, reset.chatId, reset.agentId, reset.userId, now])
  })
}

// Both ids are percent-encoded so a colon inside one cannot shift the separator: ('group:42', '7')
// and ('group', '42:7') are distinct routes, not one shared session.
export function sessionRouteKey(chatId: string, rawUserId: string): string {
  return `${SESSION_ROUTE_KEY_PREFIX}${encodeURIComponent(chatId)}:${encodeURIComponent(rawUserId)}`
}

function buildSql(d: Dialect) {
  return {
    get: `SELECT agent_id, user_id FROM bindings WHERE channel = ${d.param(1)} AND chat_id = ${d.param(2)}`,
    put: d.upsert('bindings', {
      keys: ['channel', 'chat_id'],
      cols: [...BINDING_COLS],
      rowCount: 1,
    }),
    remove: `DELETE FROM bindings WHERE channel = ${d.param(1)} AND chat_id = ${d.param(2)}`,
    listSessionRoutes:
      `SELECT c.key FROM channel_state AS c JOIN sessions AS s ON s.id = c.value ` +
      `WHERE c.channel = ${d.param(1)} AND s.channel = ${d.param(2)} ` +
      `AND s.chat_id = ${d.param(3)} AND c.key LIKE ${d.param(4)}`,
    removeSessionRoute: `DELETE FROM channel_state WHERE channel = ${d.param(1)} AND key = ${d.param(2)}`,
    list: 'SELECT channel, chat_id, agent_id, user_id FROM bindings ORDER BY updated_at DESC',
  }
}
