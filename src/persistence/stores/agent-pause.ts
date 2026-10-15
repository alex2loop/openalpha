import type { AgentPauseStore } from '@/core/types/agent-pause'
import type { Dialect, Storage } from '@/core/types/storage'
import { agentId } from '@/core/ids'

export function createAgentPauseStore(db: Storage, dialect: Dialect): AgentPauseStore {
  const p = dialect.param

  return {
    async isPaused(id) {
      const rows = await db.query<{ readonly agent_id: string }>(
        `SELECT agent_id FROM agent_pauses WHERE agent_id = ${p(1)}`,
        [id]
      )

      return rows.length > 0
    },

    async list() {
      const rows = await db.query<{ readonly agent_id: string }>(
        'SELECT agent_id FROM agent_pauses',
        []
      )

      return new Set(rows.map((row) => agentId(row.agent_id)))
    },

    async pause(ids, at) {
      await db.transaction(async (tx) => {
        for (const id of ids) {
          await tx.execute(
            `INSERT INTO agent_pauses (agent_id, paused_at) VALUES (${p(1)}, ${p(2)}) ` +
              'ON CONFLICT (agent_id) DO NOTHING',
            [id, at]
          )
        }
      })
    },

    async resume(ids) {
      await db.transaction(async (tx) => {
        for (const id of ids) {
          await tx.execute(`DELETE FROM agent_pauses WHERE agent_id = ${p(1)}`, [id])
        }
      })
    },
  }
}
