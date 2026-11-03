import type { Dialect, Storage } from '@/core/types/storage'
import { assertNotAborted } from '@/core/errors'

interface OverrideRow {
  readonly payload: string
}

/** The settings an operator changed, kept as one opaque payload per section: the host that wrote it
 *  validates what it reads back, since only it knows the shape. */
export interface ConfigOverrideStore {
  /** Absent when the section was never written. */
  read(section: string, signal: AbortSignal): Promise<string | undefined>
  write(section: string, payload: string, now: number): Promise<void>
}

export function createConfigOverrideStore(db: Storage, dialect: Dialect): ConfigOverrideStore {
  const p = dialect.param

  return {
    async read(section, signal) {
      assertNotAborted(signal)

      const rows = await db.query<OverrideRow>(
        `SELECT payload FROM config_overrides WHERE section = ${p(1)}`,
        [section]
      )

      return rows[0]?.payload
    },

    async write(section, payload, now) {
      await db.execute(
        `INSERT INTO config_overrides (section, payload, updated_at) VALUES (${dialect.paramList(3)}) ` +
          'ON CONFLICT (section) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
        [section, payload, now]
      )
    },
  }
}
