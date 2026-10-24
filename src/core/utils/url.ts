/** The `host[:port]` a URL goes to, for a surface that says where a request lands; absent for a
 *  string that is not a URL (a base URL an operator mistyped names no host). */
export function hostOfUrl(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).host : undefined
}
