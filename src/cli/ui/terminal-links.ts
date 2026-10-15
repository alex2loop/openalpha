import { sanitizeDisplayText, stripAnsi } from '@/core/utils/text'

const OSC = '\x1b]8'
const ST = '\x1b\\'
const ALLOWED_LINK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])
const LINK_CONTROL_RE = /[\p{Cc}\p{Cf}]/u

export function formatTerminalLink(url: string, hyperlinks: boolean): string {
  const visible = sanitizeDisplayText(url)
  const target = hyperlinks ? toTerminalLinkTarget(url) : undefined

  if (target === undefined) {
    return visible
  }

  return `${OSC};;${target}${ST}${visible}${OSC};;${ST}`
}

export function isLinkableUrl(url: string): boolean {
  return toTerminalLinkTarget(url) !== undefined
}

function toTerminalLinkTarget(url: string): string | undefined {
  if (LINK_CONTROL_RE.test(url) || stripAnsi(url) !== url) {
    return undefined
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  if (
    !ALLOWED_LINK_SCHEMES.has(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return undefined
  }

  return parsed.href
}
