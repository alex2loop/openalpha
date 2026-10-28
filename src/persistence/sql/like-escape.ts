const LIKE_PREFIX_ESCAPE_RE = /[\\%_]/g

export function toLikePrefixPattern(prefix: string): string {
  return `${prefix.replace(LIKE_PREFIX_ESCAPE_RE, '\\$&')}%`
}

/** A pattern matching anywhere in the text: the query's own `%` and `_` stay literal. */
export function toLikeContainsPattern(text: string): string {
  return `%${text.replace(LIKE_PREFIX_ESCAPE_RE, '\\$&')}%`
}
