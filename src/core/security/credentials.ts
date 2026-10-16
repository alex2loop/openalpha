import { BRAND } from '@/core/brand'
import { AppError, ValidationError } from '@/core/errors'

/** Longest key body scanned for its END marker; it keeps a page of repeated headers linear. */
const MAX_PRIVATE_KEY_BODY_CHARS = 16_384
const PRIVATE_KEY_BEGIN = '-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----'
const PRIVATE_KEY_END = '-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----'
// A new BEGIN ends the body so each header scans only up to the next one, never to the end of input.
const PRIVATE_KEY_BLOCK_RE = new RegExp(
  `${PRIVATE_KEY_BEGIN}(?:(?!-----BEGIN)[\\s\\S]){0,${MAX_PRIVATE_KEY_BODY_CHARS}}?${PRIVATE_KEY_END}`,
  'g'
)
// The left edge is a non-alphanumeric or a camelCase hump (`accessToken`), so `bypass:` and
// `compass:` are not read as `pass:`. The value must look like a secret (8+ characters), which
// leaves `pass: 12` and `token: ETH` alone.
const ASSIGNMENT_LEFT_EDGE = '(?:(?<![A-Za-z0-9])|(?<=(?-i:[a-z0-9]))(?=(?-i:[A-Z])))'
// `KEY` is qualified rather than bare, and `PWD` needs a separator before it: an unqualified form
// eats `PRIMARY_KEY=5` and the shell's own `PWD=`, redacting ordinary output the model needs.
const ASSIGNMENT_KEYWORD =
  '(?:(?:API|MASTER|ENCRYPTION|SIGNING|PRIVATE|ACCESS|AUTH|SECRET)[_-]?KEY|SECRET|TOKEN|PASS(?:WORD|WD|PHRASE)?|CREDENTIAL|(?<=[_-])PWD)'
// A JSON key closes its quote before the colon (`"password": "x"`), and a JSON string nested in
// another one escapes both quotes (`\"password\": \"x\"`).
const ASSIGNMENT_KEY_CLOSE = `(?:\\\\?["'])?`
// A value already replaced by an earlier pattern or a structural mask, quoted or not, is not a value
// to redact again.
const ASSIGNMENT_VALUE = `(?!\\\\?["']?\\[REDACTED\\])(?:\\\\?"[^"]{8,}"|\\\\?'[^']{8,}'|[^\\s,;"'}\\]]{8,})`
const ASSIGNMENT_RE = new RegExp(
  `${ASSIGNMENT_LEFT_EDGE}${ASSIGNMENT_KEYWORD}${ASSIGNMENT_KEY_CLOSE}\\s*[=:]\\s*${ASSIGNMENT_VALUE}`,
  'gi'
)

// Compiled once at module load; 'g' flag requires reset per-use via SECRET_PATTERNS_NONGLOBAL.
const SECRET_PATTERNS: readonly RegExp[] = [
  // First, so a key header sharing a line with a key name or cookie is never split off its body.
  // The whole block: redacting the marker alone leaks the body and blinds every downstream detector
  // that keys off the header.
  PRIVATE_KEY_BLOCK_RE,
  new RegExp(PRIVATE_KEY_BEGIN, 'g'),
  /-----BEGIN CERTIFICATE-----/gi,
  /Authorization:\s*(Bearer|Bot|Basic)\s+[A-Za-z0-9._\-+/=]{12,}/gi,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/gi,
  ASSIGNMENT_RE,
  /(authorization|x-api-key|x-anthropic-api-key)\s*:\s*(?:bearer\s+)?\S+/gi,
  // A cookie header carries every pair on one line, so the whole line goes; requiring a `name=`
  // first leaves prose such as `a cookie: chocolate chip` alone.
  /\b(?:set-)?cookie\s*:\s*[^\s=]+=[^\r\n]*/gi,
  // Telegram bot token, anchored to its `/bot` path prefix. The bare id:secret shape also matches
  // any numeric id followed by a long slug, which refused ordinary URLs as credential leaks. The
  // request URL carries the colon percent-encoded, so both spellings are the same secret.
  /\/bot\d{6,}(?::|%3[Aa])[A-Za-z0-9_-]{20,}/g,
  // Zalo bot token. It carries no fixed id:secret shape, so only the host it is addressed to
  // separates it from an ordinary path segment; the host is matched with it rather than guessed at.
  /bot-api\.zaloplatforms\.com\/bot[^/\s]+/gi,
  // `sk-` keys (OpenAI, Anthropic, OpenRouter) hold a 16+ character hyphen-free run; a slug such as
  // `sk-hynix-earnings-preview` is short hyphen-separated words and never does.
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{0,96}?[A-Za-z0-9_]{16,}[A-Za-z0-9_-]*/g,
  /(?<![A-Za-z0-9_])(?:github_pat_[A-Za-z0-9_]{22,}|gh[pousr]_[A-Za-z0-9]{36,})/g,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{35}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(https?|ftp|smtp|postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|rediss|amqp|amqps):\/\/[^:\s]{1,1024}:[^@\s]{1,1024}@/gi,
  /(s|r)k_(live|test)_[0-9a-zA-Z]{24}/gi,
]

const SECRET_PATTERNS_NONGLOBAL: readonly RegExp[] = SECRET_PATTERNS.map(
  (re) => new RegExp(re.source, re.flags.replace('g', ''))
)

// Matched against whole word parts of a field name, never as substrings: `monkey`, `keywords` and
// `tokenizer` are not secrets, and redacting them only destroys diagnostics.
const SENSITIVE_KEY_PARTS: ReadonlySet<string> = new Set([
  'key',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'password',
  'passwd',
  'pwd',
  'dsn',
  'credential',
  'authorization',
  'cookie',
])

// Plural-only counts, never credentials: `maxTokens`/`inputTokens` are numbers, and depluralizing
// them into `token` hides the whole usage record from the operator.
const COUNT_KEY_PARTS: ReadonlySet<string> = new Set(['tokens'])
// A duration names a number by convention (`*Ms`), so `credentialCooldownMs` is a wait, not a secret.
const DURATION_KEY_SUFFIX = 'ms'

/** How far a logged error's cause chain is followed. Three reaches the driver's own message under
 *  the usual wrap-once-per-boundary shape, and bounds a self-referential chain. */
const MAXIMUM_CAUSE_DEPTH = 3

const KEY_WORD_SPLIT_RE = /[^a-z0-9]+/
const CAMEL_BOUNDARY_RE = /([a-z0-9])([A-Z])/g
const PLURAL_SUFFIX_RE = /s$/

/** Longest tail a stream scrubber withholds while a word or line is unfinished; past it the tail is
 *  scrubbed and emitted as it stands. */
const MAX_HELD_CHARS = 512
const PRIVATE_KEY_FRAME_CHARS = 256
const MAX_HELD_PRIVATE_KEY_CHARS = MAX_PRIVATE_KEY_BODY_CHARS + PRIVATE_KEY_FRAME_CHARS
const WHITESPACE_RE = /\s/
// Every pattern that reads across whitespace opens at one of these: a key name before its
// separator (the end of the text counts, the separator may still be coming), a header name, or the
// bearer scheme. The cookie pattern runs to the end of its line, so a line is the unit of a hold.
const HOLD_KEYWORD_OPEN = `(?:(?:${ASSIGNMENT_KEYWORD}|authorization|x-api-key|x-anthropic-api-key|(?:set-)?cookie)${ASSIGNMENT_KEY_CLOSE}\\s*(?:[=:]|$)|bearer)`
const HOLD_KEYWORD_OPEN_RE = new RegExp(HOLD_KEYWORD_OPEN, 'gi')
const HOLD_KEYWORD_SETTLED_RE = new RegExp(`^${HOLD_KEYWORD_OPEN}\\s*\\S[^\\r\\n]*[\\r\\n]`, 'i')
const HOLD_PRIVATE_KEY_OPEN_RE = /-----BEGIN/g
// A certificate marker is the whole secret once its header closes; a private key's body follows it.
const HOLD_PRIVATE_KEY_SETTLED_RE = new RegExp(
  `^(?:${PRIVATE_KEY_BLOCK_RE.source}|(?!${PRIVATE_KEY_BEGIN})-----BEGIN[^-]*-----)`
)

interface HoldRule {
  readonly open: RegExp
  readonly settled: RegExp
  readonly span: number
}

const HOLD_RULES: readonly HoldRule[] = [
  { open: HOLD_KEYWORD_OPEN_RE, settled: HOLD_KEYWORD_SETTLED_RE, span: MAX_HELD_CHARS },
  {
    open: HOLD_PRIVATE_KEY_OPEN_RE,
    settled: HOLD_PRIVATE_KEY_SETTLED_RE,
    span: MAX_HELD_PRIVATE_KEY_CHARS,
  },
]

export const REDACT_FIELD_PATHS: ReadonlySet<string> = new Set([
  'token',
  'api_key',
  'apiKey',
  'apikey',
  'bot_token',
  'botToken',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'password',
  'passwd',
  'pwd',
  'secret',
  'client_secret',
  'clientSecret',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  '*.token',
  '*.api_key',
  '*.apiKey',
  '*.bot_token',
  '*.botToken',
  '*.access_token',
  '*.accessToken',
  '*.refresh_token',
  '*.refreshToken',
  '*.password',
  '*.secret',
  '*.authorization',
  '*.cookie',
])

export function scrubCredentials(input: string): string {
  if (!input) {
    return input
  }
  let out = input
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]')
  }

  return out
}

export interface StreamScrubber {
  /** Text safe to emit now, scrubbed; the unfinished tail waits for the next push. */
  push(delta: string): string
  /** The held tail, scrubbed. Call at the end of the stream and before any frame of another kind. */
  flush(): string
}

/** Scrubs a stream whose secrets may straddle deltas. Emission stops at a word boundary, and at the
 *  start of any construct whose pattern reads across whitespace until that construct is complete,
 *  so the emitted text equals scrubbing the whole stream. */
export function createStreamScrubber(): StreamScrubber {
  let held = ''

  return {
    push(delta) {
      const text = held + delta
      const cut = releasePoint(text)

      held = text.slice(cut)

      return scrubCredentials(text.slice(0, cut))
    },
    flush() {
      const out = scrubCredentials(held)

      held = ''

      return out
    },
  }
}

function releasePoint(text: string): number {
  const wordStart = wordStartAt(text, text.length)
  let point = text.length - wordStart > MAX_HELD_CHARS ? text.length : wordStart

  for (const rule of HOLD_RULES) {
    point = Math.min(point, firstUnsettled(text, rule, wordStart))
  }

  return point
}

// Settledness is judged on the text before the unfinished last word, so a cut never lands inside a
// construct that merely ends at the end of the text.
function firstUnsettled(text: string, rule: HoldRule, wordStart: number): number {
  const floor = text.length - rule.span - 1

  for (const match of text.matchAll(rule.open)) {
    if (match.index < floor) {
      continue
    }

    // Walking back past the floor already means the construct is out of span, so stop there.
    const from = wordStartAt(text, match.index, floor)

    if (text.length - from <= rule.span && !rule.settled.test(text.slice(match.index, wordStart))) {
      return from
    }
  }

  return text.length
}

function wordStartAt(text: string, index: number, floor = 0): number {
  let start = index

  while (start > Math.max(floor, 0) && !WHITESPACE_RE.test(text.charAt(start - 1))) {
    start -= 1
  }

  return start
}

export function hasLikelySecret(input: string): boolean {
  if (!input) {
    return false
  }
  return SECRET_PATTERNS_NONGLOBAL.some((re) => re.test(input))
}

export function isSensitiveKey(key: string): boolean {
  const words = key.replace(CAMEL_BOUNDARY_RE, '$1 $2').toLowerCase().split(KEY_WORD_SPLIT_RE)

  if (words.length > 1 && words.at(-1) === DURATION_KEY_SUFFIX) {
    return false
  }

  return words.some(isSensitiveKeyWord)
}

function isSensitiveKeyWord(word: string): boolean {
  if (SENSITIVE_KEY_PARTS.has(word)) {
    return true
  }

  return !COUNT_KEY_PARTS.has(word) && SENSITIVE_KEY_PARTS.has(word.replace(PLURAL_SUFFIX_RE, ''))
}

/** The variable itself, or the same name under this product's env namespace for a host that keeps
 *  each app's secrets apart. An empty value is unset. Names are code-owned; only the value ever
 *  comes from the environment. */
export function resolveCredential(
  env: Readonly<Record<string, string | undefined>>,
  variable: string
): string | undefined {
  return nonEmpty(env[variable]) ?? nonEmpty(env[`${BRAND.envPrefix}${variable}`])
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === '' ? undefined : value
}

/** The named variables that hold nothing yet. */
export function missingCredentials(
  env: Readonly<Record<string, string | undefined>>,
  names: Readonly<Record<string, string>> | undefined
): readonly string[] {
  return Object.values(names ?? {}).filter((name) => resolveCredential(env, name) === undefined)
}

export function rejectIfSecret(value: string): void {
  if (hasLikelySecret(value)) {
    throw new ValidationError('value contains a secret pattern', { key: 'errors.secretRejected' })
  }
}

export function redact(value: string): string {
  return scrubCredentials(value)
}

interface ErrForLog {
  type?: string
  code?: string
  message: string
  stack?: string
  cause?: CauseForLog
}

interface CauseForLog {
  type?: string
  code?: string
  message: string
  cause?: CauseForLog
}

// Every text field is scrubbed: Error.stack and provider messages echo auth headers, URL-embedded
// passwords, and API keys.
export function formatErrForLog(err: unknown): ErrForLog {
  if (!(err instanceof Error)) {
    return { message: scrubCredentials(String(err)) }
  }

  const out: ErrForLog = {
    type: err.name,
    message: scrubCredentials(err.message),
  }

  if (err instanceof AppError) {
    out.code = err.code
  }
  if (err.stack) {
    out.stack = scrubCredentials(err.stack)
  }

  const cause = formatCause(err.cause, MAXIMUM_CAUSE_DEPTH)

  if (cause !== undefined) {
    out.cause = cause
  }

  return out
}

/** A wrapper names the boundary that failed; only its cause names what actually failed, and a
 *  driver's `FOREIGN KEY constraint failed` is unrecoverable from the wrapper alone. Stacks stop at
 *  the top level — the wrap site is already there, and a chain of them buries the payload. */
function formatCause(cause: unknown, depth: number): CauseForLog | undefined {
  if (cause === undefined || cause === null || depth <= 0) {
    return undefined
  }

  if (!(cause instanceof Error)) {
    return { message: scrubCredentials(String(cause)) }
  }

  const out: CauseForLog = {
    type: cause.name,
    message: scrubCredentials(cause.message),
  }

  if (cause instanceof AppError) {
    out.code = cause.code
  }

  const next = formatCause(cause.cause, depth - 1)

  if (next !== undefined) {
    out.cause = next
  }

  return out
}
