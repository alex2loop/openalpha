#!/usr/bin/env bun
// Keeps the contributed CLI command contract deliberately poor. A command that wants flags,
// colors, Needs, or daemon gating is promoted to a built-in in cli/registry.ts — the contract
// is never widened to follow it. Growing this allow-list is the reviewable act.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONTRACT_PATH = resolve(import.meta.dir, '../src/core/types/cli-command.ts')
const ALLOWED_EXPORTS: ReadonlySet<string> = new Set([
  'CliTextKey',
  'CliText',
  'CliArgSpec',
  'CliArgValue',
  'CliParsedArgs',
  'CliWriter',
  'CliContext',
  'CliCommandDef',
])
const ALLOWED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  CliText: ['key', 'params'],
  CliArgSpec: ['positional', 'positionalOptional', 'positionalRest'],
  CliContext: ['locale', 'signal', 'out', 'err'],
  CliCommandDef: ['name', 'summary', 'spec', 'run'],
}
const EXPORT_RE = /^export (?:type|interface) (\w+)/gm
const INTERFACE_RE = /export interface (\w+) \{([\s\S]*?)\n\}/g
const FIELD_RE = /^ {2}(?:readonly )?(\w+)\??\s*[:(]/gm

const PROMOTION_RULE =
  'a command that needs more than this contract is promoted to a built-in in cli/registry.ts; ' +
  'the contract is never widened to follow it (core/types/cli-command.ts doc comment)'

function fail(message: string): never {
  process.stderr.write(`check-cli-contract: ${message}\n  rule: ${PROMOTION_RULE}\n`)
  process.exit(1)
}

const source = readFileSync(CONTRACT_PATH, 'utf8')

for (const match of source.matchAll(EXPORT_RE)) {
  const name = match[1]

  if (name !== undefined && !ALLOWED_EXPORTS.has(name)) {
    fail(`unexpected export '${name}'`)
  }
}

for (const match of source.matchAll(INTERFACE_RE)) {
  const [, name, body] = match
  const allowed = name === undefined ? undefined : ALLOWED_FIELDS[name]

  if (name === undefined || body === undefined || allowed === undefined) {
    continue
  }

  for (const field of body.matchAll(FIELD_RE)) {
    if (field[1] !== undefined && !allowed.includes(field[1])) {
      fail(`unexpected field '${name}.${field[1]}'`)
    }
  }
}

process.stdout.write('check-cli-contract: ok\n')
