import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { CliApp } from '@/cli/types'
import { warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { isEnvName } from '@/core/config/resolve'
import { isErrno } from '@/core/errors'
import {
  ensurePrivateDirectory,
  HAS_DIRECTORY_MODES,
  replacePrivateFileAtomic,
} from '@/core/security/private-files'
import { t } from '@/i18n'

const BYTE_ORDER_MARK = '\uFEFF'
const LINE_BREAK_RE = /\r?\n/
const EXPORT_PREFIX_RE = /^export\s+/
const ESCAPED_RE = /\\(["\\])/g
const QUOTE_NEEDED_RE = /[\s#"']/
const ESCAPE_RE = /["\\]/g
const OTHERS_MODE_MASK = 0o077
const DOUBLE_QUOTE = '"'
const SINGLE_QUOTE = "'"

export interface KeyFile {
  readonly path: string
  /** The names this file set in the environment; a name the shell already held is not here. */
  readonly loaded: ReadonlySet<string>
}

export type EnvFileLoad =
  | { readonly kind: 'missing'; readonly file: KeyFile }
  | { readonly kind: 'open'; readonly file: KeyFile }
  | { readonly kind: 'loaded'; readonly file: KeyFile; readonly badLines: readonly number[] }

interface EnvFileEntry {
  readonly path: string
  readonly name: string
  readonly value: string
}

interface ParsedEnv {
  readonly entries: ReadonlyMap<string, string>
  /** 1-based numbers of the lines that are neither blank, a comment nor NAME=value. */
  readonly badLines: readonly number[]
}

/** Boot only (sync): sets each name the file holds and the environment does not, so every reader
 *  of `process.env` sees a saved key. A file other users can read is left alone. */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv): EnvFileLoad {
  const text = readPrivateText(path)

  if (text === undefined) {
    return { kind: 'missing', file: { path, loaded: new Set() } }
  }

  if (text === null) {
    return { kind: 'open', file: { path, loaded: new Set() } }
  }

  const parsed = parseEnvText(text)
  const loaded = new Set<string>()

  for (const [name, value] of parsed.entries) {
    if ((env[name] ?? '') === '') {
      env[name] = value
      loaded.add(name)
    }
  }

  return { kind: 'loaded', file: { path, loaded }, badLines: parsed.badLines }
}

/** Says once, on stderr, what the key file could not do: it was left alone for being readable by
 *  others, or a line in it is not NAME=value. */
export function reportKeyFile(app: Pick<CliApp, 'config' | 'err'>, load: EnvFileLoad): void {
  const locale = app.config.locale.language
  const { path } = load.file

  if (load.kind === 'open') {
    app.err(warn(t(locale, 'cli.envFileOpen', { path })))
  } else if (load.kind === 'loaded' && load.badLines[0] !== undefined) {
    app.err(warn(t(locale, 'cli.envFileBadLine', { path, line: load.badLines[0] })))
  }
}

export async function readEnvFile(path: string): Promise<ReadonlyMap<string, string>> {
  return parseEnvText(await readTextOrEmpty(path)).entries
}

/** Replaces the line that sets `name`, or appends one; every other line and comment stays. The
 *  write goes through a 0600 temp file, so two writers leave one whole file, never a torn one. */
export async function writeEnvFileValue(input: EnvFileEntry): Promise<void> {
  const lines = splitLines(await readTextOrEmpty(input.path))
  const line = `${input.name}=${formatValue(input.value)}`
  const last = lines.findLastIndex((candidate) => nameOfLine(candidate) === input.name)

  // A later line wins when the file loads, so the new value takes the last one's place and any
  // earlier line for the name goes: the value just saved is the one that applies.
  const kept = lines.flatMap((candidate, index) => {
    if (index === last) {
      return [line]
    }

    return nameOfLine(candidate) === input.name ? [] : [candidate]
  })

  await writeLines(input.path, last === -1 ? [...kept, line] : kept)
}

export async function removeEnvFileValue(path: string, name: string): Promise<boolean> {
  const lines = splitLines(await readTextOrEmpty(path))
  const kept = lines.filter((line) => nameOfLine(line) !== name)

  if (kept.length === lines.length) {
    return false
  }

  await writeLines(path, kept)

  return true
}

/** undefined: no file. null: a file other users can read, which is not read at all. */
function readPrivateText(path: string): string | null | undefined {
  let fd: number

  try {
    fd = openSync(path, 'r')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT') || isErrno(err, 'ENOTDIR')) {
      return undefined
    }

    throw err
  }

  try {
    const info = fstatSync(fd)

    if (!info.isFile()) {
      return undefined
    }

    if (HAS_DIRECTORY_MODES && (info.mode & OTHERS_MODE_MASK) !== 0) {
      return null
    }

    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return ''
    }

    throw err
  }
}

function parseEnvText(text: string): ParsedEnv {
  const entries = new Map<string, string>()
  const badLines: number[] = []

  for (const [index, line] of splitLines(text).entries()) {
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    const entry = parseEntry(trimmed)

    if (entry === undefined) {
      badLines.push(index + 1)
    } else if (!isReserved(entry.name)) {
      applyEntry(entries, entry)
    }
  }

  return { entries, badLines }
}

/** Names with the brand prefix steer this process (the background mark would let `upgrade` restart
 *  a terminal daemon), and a systemd EnvironmentFile may hold them for the unit: skipped silently. */
function isReserved(name: string): boolean {
  return name.startsWith(BRAND.envPrefix)
}

/** An empty value counts as unset, as it does in the environment, and unsets an earlier line. */
function applyEntry(
  entries: Map<string, string>,
  entry: { readonly name: string; readonly value: string }
): void {
  if (entry.value === '') {
    entries.delete(entry.name)
  } else {
    entries.set(entry.name, entry.value)
  }
}

function parseEntry(line: string): { readonly name: string; readonly value: string } | undefined {
  const body = line.replace(EXPORT_PREFIX_RE, '')
  const equals = body.indexOf('=')

  if (equals === -1) {
    return undefined
  }

  const name = body.slice(0, equals).trim()

  return isEnvName(name) ? { name, value: parseValue(body.slice(equals + 1).trim()) } : undefined
}

function parseValue(raw: string): string {
  const quote = raw[0]

  if (raw.length < 2 || raw.at(-1) !== quote) {
    return raw
  }

  if (quote === DOUBLE_QUOTE) {
    return raw.slice(1, -1).replace(ESCAPED_RE, '$1')
  }

  return quote === SINGLE_QUOTE ? raw.slice(1, -1) : raw
}

function formatValue(value: string): string {
  return QUOTE_NEEDED_RE.test(value)
    ? `${DOUBLE_QUOTE}${value.replace(ESCAPE_RE, '\\$&')}${DOUBLE_QUOTE}`
    : value
}

function nameOfLine(line: string): string | undefined {
  return parseEntry(line.trim())?.name
}

function splitLines(text: string): string[] {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  const lines = body.split(LINE_BREAK_RE)

  // The newline that ends the last line is not another, empty line.
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

async function writeLines(path: string, lines: readonly string[]): Promise<void> {
  await ensurePrivateDirectory(dirname(path))
  await replacePrivateFileAtomic({
    path,
    content: lines.length === 0 ? '' : `${lines.join('\n')}\n`,
  })
}
