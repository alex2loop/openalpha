import type { ChannelId } from '@/core/channels'
import type { SessionId } from '@/core/ids'
import type { PollOffsetStore, SessionKey, SessionRouter } from '@/core/types/session'
import type { Dialect, Storage } from '@/core/types/storage'
import { StorageError } from '@/core/errors'
import { sessionId } from '@/core/ids'
import { sessionRouteKey } from '@/persistence/stores/channel/chat-binding'

const STATE_COLS = ['value', 'updated_at'] as const
const POLL_OFFSET_KEY = 'poll_offset'

interface ValueRow {
  readonly value: string
}

export function createSessionRouter(db: Storage, dialect: Dialect): SessionRouter {
  const sql = buildSql(dialect)

  return {
    async get(key: SessionKey): Promise<SessionId | null> {
      const rows = await db.query<ValueRow>(sql.get, [
        key.channel,
        sessionRouteKey(key.chatId, key.userId),
      ])
      const row = rows[0]

      return row ? sessionId(row.value) : null
    },

    async getOrCreate(key: SessionKey, candidate: SessionId): Promise<SessionId> {
      const routeKey = sessionRouteKey(key.chatId, key.userId)

      return db.transaction(async (tx) => {
        const nowMs = Date.now()
        await tx.execute(sql.insertOrIgnore, [key.channel, routeKey, candidate, nowMs])
        const rows = await tx.query<ValueRow>(sql.get, [key.channel, routeKey])
        const row = rows[0]

        if (!row) {
          throw new StorageError('channel_state session row missing after insert-or-read')
        }

        return sessionId(row.value)
      })
    },

    async put(key: SessionKey, id: SessionId): Promise<void> {
      await db.execute(sql.put, [
        key.channel,
        sessionRouteKey(key.chatId, key.userId),
        id,
        Date.now(),
      ])
    },
  }
}

export function createPollOffsetStore(db: Storage, dialect: Dialect): PollOffsetStore {
  const sql = buildSql(dialect)

  return {
    async get(channel: ChannelId): Promise<number | null> {
      const rows = await db.query<ValueRow>(sql.get, [channel, POLL_OFFSET_KEY])
      const row = rows[0]

      if (!row) {
        return null
      }

      const offset = Number(row.value)

      // A corrupted cursor must not wedge the poll loop: treat it as "never polled".
      return Number.isSafeInteger(offset) ? offset : null
    },

    async set(channel: ChannelId, offset: number): Promise<void> {
      await db.execute(sql.put, [channel, POLL_OFFSET_KEY, String(offset), Date.now()])
    },
  }
}

function buildSql(d: Dialect) {
  return {
    get: `SELECT value FROM channel_state WHERE channel = ${d.param(1)} AND key = ${d.param(2)}`,
    put: d.upsert('channel_state', {
      keys: ['channel', 'key'],
      cols: [...STATE_COLS],
      rowCount: 1,
    }),
    insertOrIgnore: `INSERT INTO channel_state (channel, key, value, updated_at) VALUES (${d.paramList(4)}) ON CONFLICT (channel, key) DO NOTHING`,
  }
}
