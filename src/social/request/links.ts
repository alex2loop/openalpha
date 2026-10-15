import { isPlainRecord } from '@/core/utils/collections'

const MAX_DEPTH = 20
const WWW_PREFIX = /^www\./
const TRAILING_DOT = /\.$/
const INVISIBLE_RE = /\p{Cf}/gu
const IDEOGRAPHIC_DOT_RE = /[\u3002\uff0e\uff61]/g
const BACKSLASH_RE = /\\/g
const URL_RE = /\bhttps?:\/\/?[^\s<>"'`)\]]+/gi
const MARKDOWN_TARGET_RE = /\]\(([^)\s]+)\)/g
/** `www.` or `//`, past any `name@` in front of the host, which is where a browser goes. */
const SCHEMELESS_RE =
  /(?:^|[^\p{L}\p{N}.@/-])(?:\/\/|www\.)(?:[^\s@/]+@)?([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/giu
/** Any scheme: `http:/evil.example` with one slash still opens evil.example in a browser. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
/** A bare host (any script, or an IPv4 address) counts only with a path or a port after it
 *  (`evil.example/x`, `10.0.0.1:8080`). Without one, `HPG.VN`, `Node.js` and `file.md` would draft
 *  every analyst post, and a bare host is not a tapped link. */
const BARE_HOST_RE =
  /(?<![\p{L}\p{N}.-])((?:[\p{L}\p{N}-]+\.)+(?:\p{L}{2,24}|xn--[a-z0-9-]{1,59})|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5}(?![\d.])|(?::\d{2,5})?\/\S)/giu

/** Every host the value names that is not the API host, deduplicated. Errs toward finding a link,
 *  because a false find costs only a draft. */
export function outsideLinks(value: unknown, apiHost: string): readonly string[] {
  const own = toComparableHost(apiHost)
  const hosts = new Set<string>()

  for (const text of stringsIn(value, 0)) {
    for (const host of hostsIn(text)) {
      if (toComparableHost(host) !== own) {
        hosts.add(host.toLowerCase())
      }
    }
  }

  return [...hosts]
}

/** Values at any key, never the keys: arrays and plain objects are walked to a fixed depth. */
function stringsIn(value: unknown, depth: number): readonly string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (depth >= MAX_DEPTH) {
    // Too deep to walk is never a place to hide a link: scan what is left as one text.
    return [JSON.stringify(value) ?? '']
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsIn(item, depth + 1))
  }

  return isPlainRecord(value)
    ? Object.values(value).flatMap((item) => stringsIn(item, depth + 1))
    : []
}

/** What a browser would read: no invisible characters, `。` as `.`, `\\` as `/`. */
function toLinkText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .replace(IDEOGRAPHIC_DOT_RE, '.')
    .replace(BACKSLASH_RE, '/')
}

function hostsIn(raw: string): readonly string[] {
  const text = toLinkText(raw)
  const hosts: string[] = []

  for (const match of text.matchAll(URL_RE)) {
    pushHost(hosts, match[0])
  }

  for (const match of text.matchAll(MARKDOWN_TARGET_RE)) {
    const target = match[1] ?? ''

    if (SCHEME_RE.test(target)) {
      pushHost(hosts, target)
    }
  }

  for (const pattern of [SCHEMELESS_RE, BARE_HOST_RE]) {
    for (const match of text.matchAll(pattern)) {
      hosts.push(match[1] ?? '')
    }
  }

  return hosts.filter((host) => host !== '')
}

function pushHost(hosts: string[], raw: string): void {
  try {
    hosts.push(new URL(raw).hostname)
  } catch {
    // Not a URL after all; the schemeless patterns still look at the same text.
  }
}

/** A link to `moltbook.com/post/1` is the network's own. */
function toComparableHost(host: string): string {
  return host.toLowerCase().replace(TRAILING_DOT, '').replace(WWW_PREFIX, '')
}
