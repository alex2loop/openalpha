#!/usr/bin/env bun
// Error-message convention gate. Every message thrown from the `core/errors` hierarchy is a
// fragment other text wraps -- `Caused by: <msg>`, `request failed (<msg>)`, a tool result the
// model reads -- so it reads as a lowercase clause with no terminal punctuation, the way Go and
// Rust error strings do. Capitalised, sentence-shaped messages break every one of those frames.
// A raw `throw new Error()` bypasses the hierarchy entirely and carries no code for a surface to
// narrow on. Exit 0 = clean; any offender prints and exits 1.
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SOURCES = ['src']

// Every class carrying an operator- or model-facing message. Subclasses are listed by name because
// the gate reads text, not types.
const ERROR_CLASSES = [
  'ChannelError',
  'ConfigError',
  'MissingEnvError',
  'OperatorConfigError',
  'ConflictError',
  'HttpRequestError',
  'LLMError',
  'OrderError',
  'RunHalted',
  'SearchProviderError',
  'SearchRetryableError',
  'StorageError',
  'ToolError',
  'ValidationError',
]

// Vendor and protocol names that carry their own capitalisation into a message.
const PROPER_NOUNS = [
  'ChatGPT',
  'DuckDuckGo',
  'OKX',
  'Postgres',
  'SQLite',
  'SearXNG',
  'Telegram',
  'Zalo',
]

const MESSAGE = new RegExp(
  `new (?:${ERROR_CLASSES.join('|')})\\(\\s*(?:'[a-z_.]+',\\s*)?(['\`])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`,
  'g'
)
const RAW_THROW = /throw new Error\(/
const ACRONYM = /^[A-Z]{2,}/

interface Violation {
  readonly location: string
  readonly reason: string
  readonly message: string
}

const violations: Violation[] = []

function collectRawThrows(text: string, location: string): void {
  text.split('\n').forEach((line, index) => {
    if (RAW_THROW.test(line)) {
      violations.push({
        location: `${location}:${index + 1}`,
        reason: 'raw Error',
        message: line.trim(),
      })
    }
  })
}

function collectMessages(text: string, location: string): void {
  for (const match of text.matchAll(MESSAGE)) {
    const message = match[2] ?? ''
    const reason = offenceOf(message)

    if (reason !== undefined) {
      violations.push({ location: `${location}:${lineOf(text, match.index)}`, reason, message })
    }
  }
}

function offenceOf(message: string): string | undefined {
  if (/[.!]$/.test(message)) {
    return 'trailing punctuation'
  }

  return isCapitalised(message) ? 'capitalised' : undefined
}

function isCapitalised(message: string): boolean {
  const word = message.split(/[\s"']/)[0] ?? ''

  if (!/^[A-Z]/.test(word) || ACRONYM.test(word)) {
    return false
  }

  return !PROPER_NOUNS.some((noun) => word.startsWith(noun))
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

const glob = new Bun.Glob('**/*.ts')
let scanned = 0

for (const source of SOURCES) {
  for await (const rel of glob.scan({ cwd: resolve(ROOT, source) })) {
    const location = `${source}/${rel}`
    const text = await Bun.file(resolve(ROOT, source, rel)).text()

    scanned += 1
    collectRawThrows(text, location)
    collectMessages(text, location)
  }
}

if (violations.length > 0) {
  process.stderr.write(`FAIL: ${violations.length} error message(s) off-convention:\n`)
  process.stderr.write('  lowercase first word, no trailing "." or "!", never a raw Error.\n\n')

  for (const violation of violations) {
    process.stderr.write(`  ${violation.location}  [${violation.reason}] ${violation.message}\n`)
  }

  process.exit(1)
}

process.stdout.write(`check-error-messages: PASS (${scanned} files)\n`)
