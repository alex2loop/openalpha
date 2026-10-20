import type { Logger } from '@/core/logging/logger'
import type {
  Dialect,
  DialectName,
  FtsHit,
  FtsScope,
  FtsSearch,
  Storage,
} from '@/core/types/storage'
import { formatErrForLog } from '@/core/security/credentials'

const FTS_SNIPPET_TOKENS = 3
const FTS_CONTEXT_WINDOW = 24
const PG_CONTEXT_CHARS = 200
// The trigram tokenizer indexes 3-character windows, so a term shorter than this can never match
// through MATCH. Such terms are filtered with LIKE on the stored value instead.
const TRIGRAM_MIN_CHARS = 3
const LIKE_SNIPPET_CHARS = 200
const IMPORTANCE_DIVISOR = 5.0
const IMPORTANCE_WEIGHT = 0.5
// Mirror of memory/store's bound: a LIMIT of 0 scans everything and a negative one is a silent
// no-op on both dialects. The FTS layer repeats the guard so a direct caller can never hand the
// storage engine an invalid LIMIT.
const MEMORY_SEARCH_LIMIT_MAX = 100

// Whitelist, never a blacklist. An unquoted `-`, `"` or `*` is an FTS5 operator: a syntax error
// or a silent prefix match, not the search the caller asked for.
const FTS_TOKEN_RE = /[\p{L}\p{N}_]+/gu

const LIKE_SPECIALS_RE = /[\\%_]/g

// `rank` is higher-is-better on both dialects. bm25() returns a negative score (more negative =
// better match), hence the negation — a raw bm25 plus the importance bonus would sink important
// rows. JOIN memory_kv: the FTS5 virtual table has no deleted_at/expires_at columns.
const SQLITE_SEARCH_HEAD =
  `SELECT memory_fts.key AS key, ` +
  `snippet(memory_fts, ${FTS_SNIPPET_TOKENS}, '', '', '...', ${FTS_CONTEXT_WINDOW}) AS value, ` +
  `-bm25(memory_fts) + (memory_fts.importance / ${IMPORTANCE_DIVISOR}) * ${IMPORTANCE_WEIGHT} AS rank ` +
  `FROM memory_fts JOIN memory_kv ON memory_kv.agent_id = memory_fts.agent_id ` +
  `  AND memory_kv.user_id = memory_fts.user_id AND memory_kv.key = memory_fts.key ` +
  `WHERE memory_fts MATCH ? AND memory_fts.agent_id = ? AND memory_fts.user_id = ? ` +
  `AND memory_kv.deleted_at IS NULL AND (memory_kv.expires_at IS NULL OR memory_kv.expires_at > ?)`
const SQLITE_SHORT_FILTER = ` AND memory_kv.value LIKE ? ESCAPE '\\'`
// All terms short: no MATCH, so the rank drops bm25 and substr() stands in for snippet().
const SQLITE_LIKE_HEAD =
  `SELECT memory_kv.key AS key, substr(memory_kv.value, 1, ${LIKE_SNIPPET_CHARS}) AS value, ` +
  `(memory_kv.importance / ${IMPORTANCE_DIVISOR}) * ${IMPORTANCE_WEIGHT} AS rank ` +
  `FROM memory_kv WHERE memory_kv.agent_id = ? AND memory_kv.user_id = ? ` +
  `AND memory_kv.deleted_at IS NULL AND (memory_kv.expires_at IS NULL OR memory_kv.expires_at > ?)`
const SQLITE_LIKE_TAIL = ` ORDER BY rank DESC, memory_kv.updated_at DESC LIMIT ?`
const SQLITE_PREFIX_FILTER = ` AND memory_kv.key LIKE ? ESCAPE '\\'`
const SQLITE_SEARCH_TAIL = ` ORDER BY rank DESC LIMIT ?`

// plainto_tsquery tokenizes and escapes its own input, so no manual sanitizing here.
const PG_SEARCH_HEAD =
  `SELECT key, substring(value, 1, ${PG_CONTEXT_CHARS}) AS value, ` +
  `ts_rank(search_vector, plainto_tsquery('simple', $3)) + (importance / ${IMPORTANCE_DIVISOR}) * ${IMPORTANCE_WEIGHT} AS rank ` +
  `FROM memory_kv WHERE agent_id = $1 AND user_id = $2 ` +
  `AND search_vector @@ plainto_tsquery('simple', $3) ` +
  `AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $4)`
const PG_PREFIX_FILTER = ` AND key LIKE $6 ESCAPE '\\'`
const PG_SEARCH_TAIL = ` ORDER BY rank DESC LIMIT $5`

interface Query {
  readonly sql: string
  readonly params: readonly unknown[]
}

export function createFtsSearch(db: Storage, dialect: Dialect, logger: Logger): FtsSearch {
  return {
    async search(scope: FtsScope, query: string, limit: number): Promise<readonly FtsHit[]> {
      const built = buildQuery(dialect.name, scope, { query, limit })

      if (!built) {
        return []
      }

      try {
        return await db.query<FtsHit>(built.sql, built.params)
      } catch (err: unknown) {
        // A malformed query is a zero-result search, never a thrown exception.
        logger.warn('fts.search_error', { dialect: dialect.name, err: formatErrForLog(err) })

        return []
      }
    },
  }
}

function buildQuery(
  name: DialectName,
  scope: FtsScope,
  options: { readonly query: string; readonly limit: number }
): Query | null {
  // Repeat the Memory interface's bound here: a non-integer, zero, negative, or over-cap limit would
  // otherwise reach the SQL `LIMIT` clause. Returning null makes it a zero-result search.
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MEMORY_SEARCH_LIMIT_MAX
  ) {
    return null
  }

  const now = Date.now()
  const prefix = scope.keyPrefix === undefined ? undefined : `${escapeLike(scope.keyPrefix)}%`

  if (name === 'postgres') {
    return {
      sql: PG_SEARCH_HEAD + (prefix === undefined ? '' : PG_PREFIX_FILTER) + PG_SEARCH_TAIL,
      params:
        prefix === undefined
          ? [scope.agentId, scope.userId, options.query, now, options.limit]
          : [scope.agentId, scope.userId, options.query, now, options.limit, prefix],
    }
  }

  const tokens = options.query.match(FTS_TOKEN_RE) ?? []

  if (tokens.length === 0) {
    return null
  }

  return buildSqliteQuery(scope, { tokens, prefix, now, limit: options.limit })
}

interface SqliteArgs {
  readonly tokens: readonly string[]
  readonly prefix: string | undefined
  readonly now: number
  readonly limit: number
}

function buildSqliteQuery(scope: FtsScope, args: SqliteArgs): Query {
  const long = args.tokens.filter((token) => [...token].length >= TRIGRAM_MIN_CHARS)
  const shortLikes = args.tokens
    .filter((token) => [...token].length < TRIGRAM_MIN_CHARS)
    .map((token) => `%${escapeLike(token)}%`)
  const filters = SQLITE_SHORT_FILTER.repeat(shortLikes.length)
  const prefixSql = args.prefix === undefined ? '' : SQLITE_PREFIX_FILTER
  const prefixParams = args.prefix === undefined ? [] : [args.prefix]
  const tail = [...shortLikes, ...prefixParams, args.limit]

  // A MATCH over zero long tokens would be an empty FTS query: LIKE alone answers instead.
  if (long.length === 0) {
    return {
      sql: SQLITE_LIKE_HEAD + filters + prefixSql + SQLITE_LIKE_TAIL,
      params: [scope.agentId, scope.userId, args.now, ...tail],
    }
  }

  // Each `LIKE ?` precedes `LIMIT ?`, so the LIKE params bind before the limit.
  return {
    sql: SQLITE_SEARCH_HEAD + filters + prefixSql + SQLITE_SEARCH_TAIL,
    params: [quoteFtsTokens(long), scope.agentId, scope.userId, args.now, ...tail],
  }
}

// Whitelisted tokens only (see FTS_TOKEN_RE), each quoted so none can read as an FTS5 operator.
function quoteFtsTokens(tokens: readonly string[]): string {
  return tokens.map((token) => `"${token}"`).join(' ')
}

// A literal % or _ in a prefix must not become a wildcard.
function escapeLike(value: string): string {
  return value.replace(LIKE_SPECIALS_RE, (ch) => `\\${ch}`)
}
