export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The `host[:port]` a URL goes to, for a surface that says where a request lands; absent for a
 *  string that is not a URL (a base URL an operator mistyped names no host). */
export function hostOfUrl(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).host : undefined
}

/** `value` with every trailing `/` dropped. A scan rather than `/\/+$/`, which backtracks
 *  quadratically on a long run of slashes that is not at the end. */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length

  while (end > 0 && value[end - 1] === '/') {
    end -= 1
  }

  return value.slice(0, end)
}

export function isLoopbackUrl(endpoint: string): boolean {
  return URL.canParse(endpoint) && LOOPBACK_HOSTS.has(new URL(endpoint).hostname)
}
