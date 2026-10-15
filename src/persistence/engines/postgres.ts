import type { Pool, PoolClient, QueryResultRow } from 'pg'

import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import { ConfigError, StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { toStorageError } from '@/persistence/errors'
import { migrate } from '@/persistence/migrations/runner'
import { buildInsert, buildUpsert, paramList } from '@/persistence/sql/syntax'

const PG_POOL_MAX = 10
const PG_CONNECTION_TIMEOUT_MS = 10_000
const PG_STATEMENT_TIMEOUT_MS = 30_000
const PG_IDLE_TXN_TIMEOUT_MS = 60_000
// The backend `options` startup string is whitespace-split by the server, so `quoteIdentifier`
// cannot protect it — the name itself must be inert, asserted where the string is built.
const PG_SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/

function postgresParam(index: number): string {
  return `$${index}`
}

export const postgresDialect: Dialect = {
  name: 'postgres',
  autoIncrementPk: 'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
  param: postgresParam,
  paramList: (count, startAt) => paramList(postgresParam, count, startAt),
  upsert: (table, target) => buildUpsert(postgresParam, table, target),
  insert: (table, target) => buildInsert(postgresParam, table, target),
}

interface PostgresConnectionOptions {
  readonly url: string
  readonly schema: string
  readonly logger: Logger
}

// `pg` is imported dynamically so sqlite-only runs never load the driver.
export async function openPostgres(options: PostgresConnectionOptions): Promise<Storage> {
  if (!options.url) {
    throw new ConfigError('postgres connection URL is missing')
  }
  if (!PG_SCHEMA_NAME_RE.test(options.schema)) {
    throw new ConfigError(`postgres schema name is not a bare identifier: ${options.schema}`)
  }

  const { default: pg } = await import('pg')

  const pool = new pg.Pool({
    connectionString: options.url,
    max: PG_POOL_MAX,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
    statement_timeout: PG_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: PG_IDLE_TXN_TIMEOUT_MS,
    options: `-c search_path=${options.schema}`,
    // pg returns BIGINT as string to avoid precision loss. Ours hold epoch-ms and COUNT(*), both
    // far inside Number's 2^53 range — parse them so row shapes match sqlite. Scoped to this pool:
    // setTypeParser is process-global and would reshape every other pg consumer's BIGINTs too.
    types: {
      getTypeParser: (id, format) =>
        id === pg.types.builtins.INT8 ? Number : pg.types.getTypeParser(id, format),
    },
  })

  // Doubles as the boot probe: a bad URL must fail here, never silently at the first real query.
  try {
    await ensureSchema(pool, options.schema, options.logger)
  } catch (err: unknown) {
    await pool.end().catch(() => undefined)
    throw new StorageError('postgres unreachable', err)
  }

  return createStorage(pool, options.logger)
}

export async function resetPostgres(options: PostgresConnectionOptions): Promise<number> {
  const storage = await openPostgres(options)
  const schema = quoteIdentifier(options.schema)

  try {
    await storage.transaction(async (tx) => {
      await tx.execute(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await tx.execute(`CREATE SCHEMA ${schema}`)
    })

    return await migrate(storage, postgresDialect, { logger: options.logger })
  } finally {
    await storage.close()
  }
}

// `search_path` names the schema but never creates it, and Postgres silently skips a missing entry:
// without this every unqualified migration would land in `public` instead.
async function ensureSchema(pool: Pool, schema: string, logger: Logger): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`)
  } finally {
    releaseClient(client, logger)
  }
}

function createStorage(pool: Pool, logger: Logger): Storage {
  const onPoolError = (err: unknown): void => {
    logger.warn('postgres.pool_error', { err: formatErrForLog(err) })
  }
  pool.on('error', onPoolError)
  const tx = createTransaction(pool)
  let closeTask: Promise<void> | null = null
  let closed = false

  // Boundary rule (persistence/errors.ts): a raw driver error never escapes the Storage surface.
  const guard = <T>(op: () => Promise<T>, boundary: string): Promise<T> => {
    // Sealed on close: the pool rejects post-end work with a driver error rather than as the
    // shutdown it is, and a caller cannot tell the two apart.
    if (closed) {
      return Promise.reject(new StorageError('storage is closed'))
    }

    return op().catch((err: unknown) => Promise.reject(toStorageError(err, boundary)))
  }

  // Non-throwing: a close throw would mask whatever triggered the shutdown.
  const closeStorage = async (): Promise<void> => {
    pool.off('error', onPoolError)
    await pool.end().catch((err: unknown) => {
      logger.error('postgres.close_failed', { err: formatErrForLog(err) })
    })
  }

  return {
    query: <T>(sql: string, params?: readonly unknown[]) =>
      guard(() => tx.query<T>(sql, params), 'postgres query failed'),
    execute: (sql: string, params?: readonly unknown[]) =>
      guard(() => tx.execute(sql, params), 'postgres execute failed'),
    transaction: (fn) =>
      guard(() => runTransaction(pool, fn, logger), 'postgres transaction failed'),
    // One shared task: every caller awaits the same close, so a concurrent caller waits for
    // completion instead of returning early and a later caller reuses the settled task.
    close(): Promise<void> {
      closed = true
      closeTask ??= closeStorage()

      return closeTask
    },
  }
}

async function runTransaction<T>(
  pool: Pool,
  fn: (tx: Transaction) => Promise<T>,
  logger: Logger
): Promise<T> {
  // `client` is tracked so a failed `connect()` is wrapped as a typed StorageError and release runs
  // only once a client was actually acquired — releasing an undefined client is a no-op that would
  // otherwise mask the real connection failure.
  let client: PoolClient | undefined
  let rollbackFailed = false

  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const result = await fn(createTransaction(client))
    await client.query('COMMIT')

    return result
  } catch (err: unknown) {
    if (client !== undefined) {
      await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
        rollbackFailed = true
        logger.error('postgres.rollback_failed', { err: formatErrForLog(rollbackErr) })
      })
    }
    // A typed StorageError from the callback passes through untouched; anything else becomes one.
    throw toStorageError(err, 'postgres transaction failed')
  } finally {
    if (client !== undefined) {
      releaseClient(client, logger, rollbackFailed)
    }
  }
}

// `discard` destroys the connection instead of pooling it: a client whose ROLLBACK failed may still
// be inside its transaction, and the next borrower would inherit it.
function releaseClient(client: PoolClient, logger: Logger, discard = false): void {
  try {
    client.release(discard)
  } catch (err: unknown) {
    logger.error('postgres.release_failed', { err: formatErrForLog(err) })
  }
}

function createTransaction(q: Pool | PoolClient): Transaction {
  return {
    query: async <T>(sql: string, params: readonly unknown[] = []) =>
      (await q.query<T & QueryResultRow>(sql, [...params])).rows,
    execute: async (sql: string, params: readonly unknown[] = []) => ({
      changes: (await q.query(sql, [...params])).rowCount ?? 0,
    }),
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
