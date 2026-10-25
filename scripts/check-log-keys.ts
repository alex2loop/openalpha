#!/usr/bin/env bun
// Log-key gate. A dotted log key names one failure boundary, so it belongs to exactly one call site.
// Two sites sharing a key means one event can be logged twice under one name (the reader cannot tell
// a re-log from a second failure), or two unrelated events are indistinguishable in the log.
//
// Keys are matched by shape (`domain.event_name`, lowercase dotted snake), so prose arguments to
// unrelated `.error(...)`/`.debug(...)` methods are not mistaken for log keys.
//
// Exit 0 = clean. Failures print every offending site and exit 1.
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const PACKAGE_SOURCES = ['src']

const KEY_SOURCE = '[a-z][a-z0-9]*(?:\\.[a-z0-9_]+)+'
const LOG_CALL_RE = new RegExp(`\\.(?:info|warn|error|fatal|debug)\\(\\s*'(${KEY_SOURCE})'`, 'gs')
// A key shaped like a dotted key but spelled with a hyphen: KEY_SOURCE cannot match it, so without
// this it would slip past the one-site-per-key check.
const KEBAB_KEY_RE = new RegExp(
  `\\.(?:info|warn|error|fatal|debug)\\(\\s*'([a-z][a-z0-9]*(?:\\.[a-z0-9_-]+)+)'`,
  'gs'
)
// Every logger call, literal key or not, so a key smuggled in through a variable is visible.
const LOGGER_CALL_RE =
  /[\w.]*logger\.(?:info|warn|error|fatal|debug)\(\s*(['`]|[A-Za-z_$][\w$.]*)/gs

// Helpers that log a key their caller supplies. `param` is what the helper body passes, which the
// non-literal check exempts; `arg`/`field` say where the caller's literal sits so it still counts
// as a site.
type KeyForwarder =
  | { readonly param: string; readonly helper: string; readonly arg: number }
  | { readonly param: string; readonly field: string }

const KEY_FORWARDERS: readonly KeyForwarder[] = [
  { param: 'event', helper: 'runCleanup', arg: 1 },
  { param: 'event', helper: 'closeHandle', arg: 2 },
  { param: 'req.logKey', field: 'logKey' },
]
const FORWARDED_PARAMS: ReadonlySet<string> = new Set(KEY_FORWARDERS.map((one) => one.param))

// Keys whose sites are arms of ONE operation, distinguished by their fields rather than their name.
// Each entry states which arms; a key used by two genuinely different boundaries is renamed, never
// added here.
const SHARED_KEYS: ReadonlyMap<string, string> = new Map([
  ['plugin.root_skipped', 'one scan decision: rejected status and unreadable root'],
  ['plugin.workflow_skipped', 'one registration decision: untrusted_schedule and id_collision'],
  [
    'trading.plugin_source_skipped',
    'one skip decision: load failure, id_owned_by_builtin, id_owned_by_plugin, registration',
  ],
  [
    'scheduler.run_now_claim_release_failed',
    'one claim release, reached from the controller path and the no-daemon path',
  ],
  [
    'order.exit_orphaned',
    'one withdraw decision: the cancel failed and the cancel unavailable',
  ],
])

// One name per concept in the payload too: a consumer that greps `err.code` must not have to know
// which sites spelled it `error`.
const BANNED_FIELDS: ReadonlyMap<string, string> = new Map([
  ['error', 'use err: formatErrForLog(err)'],
  ['e', 'use err: formatErrForLog(err)'],
  ['exception', 'use err: formatErrForLog(err)'],
  ['msg', 'the log key is already the message'],
])
const FIELD_NAME_RE = /^[a-z][A-Za-z0-9]*$/
const FIELD_KEY_RE = /([A-Za-z_$][\w$]*)\s*:/g

interface Site {
  readonly file: string
  readonly line: number
}

const sites = new Map<string, Site[]>()
const fieldIssues: string[] = []
const opaqueKeys: string[] = []
const kebabKeys: string[] = []

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length

// Depth of every character of `text`, counting bracket nesting and treating quoted spans as depth-
// neutral so a brace inside a string cannot shift it.
function depths(text: string): readonly number[] {
  const out: number[] = []
  let depth = 0
  let quote = ''

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ''

    if (quote !== '') {
      out.push(depth)
      if (ch === '\\') {
        out.push(depth)
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1
    }

    out.push(depth)
  }

  return out
}

function forwardedKeyRe(one: KeyForwarder): RegExp {
  return 'arg' in one
    ? new RegExp(`\\b${one.helper}\\(\\s*(?:[^,()]*,\\s*){${one.arg}}'(${KEY_SOURCE})'`, 'gs')
    : new RegExp(`\\b${one.field}:\\s*'(${KEY_SOURCE})'`, 'gs')
}

// Top-level keys of the payload literal that follows a log key, or [] when the call has no payload.
function payloadFields(source: string, from: number): readonly string[] {
  const open = source.indexOf('{', from)

  if (open === -1 || !/^[\s,]*$/.test(source.slice(from, open))) {
    return []
  }

  const level = depths(source.slice(open))
  const end = level.indexOf(0, 1)
  const body = source.slice(open, end === -1 ? undefined : open + end)
  const fields: string[] = []

  for (const match of body.matchAll(FIELD_KEY_RE)) {
    if (match[1] !== undefined && level[match.index] === 1) {
      fields.push(match[1])
    }
  }

  return fields
}

for (const dir of PACKAGE_SOURCES) {
  const root = resolve(ROOT, dir)
  const glob = new Bun.Glob('**/*.{ts,tsx}')

  for await (const rel of glob.scan({ cwd: root })) {
    const source = await Bun.file(resolve(root, rel)).text()

    for (const match of source.matchAll(LOG_CALL_RE)) {
      const key = match[1]

      if (key === undefined) {
        continue
      }

      const site = { file: `${dir}/${rel}`, line: lineAt(source, match.index) }
      const found = sites.get(key) ?? []

      found.push(site)
      sites.set(key, found)

      for (const field of payloadFields(source, match.index + match[0].length)) {
        const banned = BANNED_FIELDS.get(field)

        if (banned !== undefined) {
          fieldIssues.push(`${site.file}:${site.line} '${key}' field '${field}' - ${banned}`)
        } else if (!FIELD_NAME_RE.test(field)) {
          fieldIssues.push(`${site.file}:${site.line} '${key}' field '${field}' - use camelCase`)
        }
      }
    }

    for (const match of source.matchAll(KEBAB_KEY_RE)) {
      if (match[1]?.includes('-')) {
        kebabKeys.push(`${dir}/${rel}:${lineAt(source, match.index)} '${match[1]}'`)
      }
    }

    for (const forwarder of KEY_FORWARDERS) {
      for (const match of source.matchAll(forwardedKeyRe(forwarder))) {
        const key = match[1]

        if (key !== undefined) {
          const found = sites.get(key) ?? []

          found.push({ file: `${dir}/${rel}`, line: lineAt(source, match.index) })
          sites.set(key, found)
        }
      }
    }

    for (const match of source.matchAll(LOGGER_CALL_RE)) {
      const head = match[1]

      if (head !== undefined && head !== "'" && !FORWARDED_PARAMS.has(head)) {
        const line = lineAt(source, match.index)

        opaqueKeys.push(
          `${dir}/${rel}:${line} logs a non-literal key - inline it, or register the helper in KEY_FORWARDERS`
        )
      }
    }
  }
}

const violations = [...sites.entries()]
  .filter(([key, found]) => found.length > 1 && !SHARED_KEYS.has(key))
  .sort(([a], [b]) => a.localeCompare(b))
const staleAllowances = [...SHARED_KEYS.keys()]
  .filter((key) => (sites.get(key)?.length ?? 0) < 2)
  .sort()

if (
  violations.length > 0 ||
  staleAllowances.length > 0 ||
  fieldIssues.length > 0 ||
  opaqueKeys.length > 0 ||
  kebabKeys.length > 0
) {
  if (violations.length > 0) {
    process.stderr.write(`FAIL: ${violations.length} log key(s) used by more than one call site:\n`)

    for (const [key, found] of violations) {
      process.stderr.write(`  '${key}'\n`)
      for (const site of found) {
        process.stderr.write(`    ${site.file}:${site.line}\n`)
      }
    }

    process.stderr.write(
      `Rename the site that names a different boundary, or add the key to SHARED_KEYS in ` +
        `scripts/check-log-keys.ts with the arms it covers.\n`
    )
  }

  if (opaqueKeys.length > 0) {
    process.stderr.write(`FAIL: ${opaqueKeys.length} log call(s) the gate cannot read:\n`)
    for (const issue of opaqueKeys) {
      process.stderr.write(`  ${issue}\n`)
    }
  }

  if (kebabKeys.length > 0) {
    process.stderr.write(`FAIL: ${kebabKeys.length} log key(s) off-convention: log keys are dotted snake_case:\n`)
    for (const issue of kebabKeys) {
      process.stderr.write(`  ${issue}\n`)
    }
  }

  if (fieldIssues.length > 0) {
    process.stderr.write(`FAIL: ${fieldIssues.length} log payload field(s) off-convention:\n`)
    for (const issue of fieldIssues) {
      process.stderr.write(`  ${issue}\n`)
    }
  }

  for (const key of staleAllowances) {
    process.stderr.write(`FAIL: '${key}' no longer has 2+ sites - drop it from SHARED_KEYS\n`)
  }

  process.exit(1)
}

process.stdout.write(
  `check-log-keys: PASS (${sites.size} keys, ${SHARED_KEYS.size} shared by allowance)\n`
)
