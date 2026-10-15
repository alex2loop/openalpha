const LIKE_PREFIX_ESCAPE_RE = /[\\%_]/g

export function toLikePrefixPattern(prefix: string): string {
  return `${prefix.replace(LIKE_PREFIX_ESCAPE_RE, '\\$&')}%`
}
