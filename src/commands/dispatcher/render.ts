import type { CommandDescription, CommandMessage, CommandMessageValue } from '@/core/types/command'
import { scrubCredentials } from '@/core/security/credentials'
import { stripControls } from '@/core/utils/text'

// A message list is capped so a runaway one never floods a chat. A command's own text is not
// capped: it is authored by the command, and the morning brief is several thousand characters of
// deliberate content. Channels chunk what exceeds their transport limit; cutting here would drop
// the tail before any surface could.
const MAX_RENDER_MESSAGES = 20
const MAX_RENDER_CHARS = 4_000
// Untrusted plugin descriptions are capped before display.
const PLUGIN_DESC_MAX_LEN = 256

/**
 * Locale lookup + presence check, injected so this module owns command rendering without a direct
 * i18n import — commands may not depend on i18n per the DAG. The surface that owns the locale
 * supplies a bound lookup (locale already captured in the closure).
 */
export interface LocaleLookup {
  translate: (key: string, params?: Record<string, string | number>) => string
  has: (key: string) => boolean
}

/**
 * Renders one command message. A missing key fails closed to a generic localized error and never
 * leaks the key or its interpolated values. Each primitive value is scrubbed (control chars
 * stripped, credential-looking substrings redacted) before interpolation, so a command can never
 * echo a secret or an injection payload.
 */
function renderMessage(i18n: LocaleLookup, message: CommandMessage): string {
  if (!i18n.has(message.key)) {
    return i18n.translate('slash.commandUnexpected')
  }

  return i18n.translate(message.key, scrubParams(i18n, message.values))
}

/** Renders a command's message list: bounded count, one scrubbed line each, capped total size. */
export function renderMessages(i18n: LocaleLookup, messages: readonly CommandMessage[]): string {
  const bounded = messages.slice(0, MAX_RENDER_MESSAGES)
  const rendered = bounded.map((message) => renderMessage(i18n, message)).join('\n')

  return rendered.length <= MAX_RENDER_CHARS
    ? rendered
    : `${rendered.slice(0, MAX_RENDER_CHARS - 1)}…`
}

/**
 * The single owner for embedder-authored `text` slash results. The content is external (like a
 * plugin command description), so it is scrubbed of credentials, stripped of control characters,
 * and capped once before any surface displays it. Surfaces receive this canonical text and must
 * not repeat sanitation.
 */
export function renderCommandText(text: string): string {
  return stripControls(scrubCredentials(text))
}

/**
 * The single command-description renderer. Built-in commands resolve their localized key; plugin
 * descriptions are untrusted manifest text, scrubbed and capped before display.
 */
export function describeCommand(i18n: LocaleLookup, description: CommandDescription): string {
  if (description.kind === 'plugin') {
    return cap(stripControls(scrubCredentials(description.text)), PLUGIN_DESC_MAX_LEN)
  }

  return renderMessage(i18n, { key: description.key })
}

// Booleans are dropped (a template never interpolates a bare boolean); numbers pass through;
// strings are scrubbed; keyed values resolve through the locale catalog (falling back to the key
// itself, which the boot locale gate makes unreachable for derived keys). Returns a fresh record
// so the caller's values are never mutated.
function scrubParams(
  i18n: LocaleLookup,
  values?: Readonly<Record<string, CommandMessageValue>>
): Record<string, string | number> {
  if (values === undefined) {
    return {}
  }
  const params: Record<string, string | number> = {}

  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'number') {
      params[name] = value
    } else if (typeof value === 'object') {
      params[name] = i18n.has(value.key) ? i18n.translate(value.key) : value.key
    } else if (typeof value !== 'boolean') {
      params[name] = stripControls(scrubCredentials(value))
    }
  }

  return params
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
