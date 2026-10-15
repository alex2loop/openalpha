import type { LocalizedText } from '@/cli/types'

const LONG_FLAG_RE = /^--([^=]+)(?:=(.*))?$/
const DECIMAL_INT_RE = /^\d+$/
const SHORT_FLAG_RE = /^-([a-zA-Z])$/
const KEBAB_BOUNDARY_RE = /-([a-z])/g
// A leading minus on a number is a sign, not a flag (`-5`, `-.5`, `-5%`); short flags are letters.
const NEGATIVE_NUMBER_RE = /^-(?:\d+(?:\.\d*)?|\.\d+)%?$/
export const END_OF_OPTIONS = '--'

interface FlagSpec {
  readonly type: 'string' | 'boolean'
  /** Repeatable (`--tag a --tag b`) or comma-joined (`--tag=a,b`); the value is always an array. */
  readonly multi?: boolean
  readonly alias?: string
  readonly choices?: readonly string[]
  readonly describe?: LocalizedText
}

export interface Spec {
  readonly positional?: readonly string[]
  /** All declared positionals are required unless the command explicitly marks them optional. */
  readonly positionalOptional?: boolean
  /** Collects every positional past the declared slots under this name, as an array. Without it,
   *  an extra positional is a usage error — which is the right default for a fixed-arity command
   *  and wrong for one whose grammar is variadic (a ledger draft, whose token count depends on the
   *  transaction kind). */
  readonly positionalRest?: string
  readonly flags?: Record<string, FlagSpec>
  /** `--` ends option parsing: the tail is `rest` when set, positional otherwise. */
  readonly separator?: '--'
}

type ArgIssueCode =
  | 'unknown_flag'
  | 'missing_value'
  | 'missing_positional'
  | 'extra_positional'
  | 'invalid_choice'
  | 'conflicting_flags'

export interface ArgIssue {
  readonly token: string
  readonly code: ArgIssueCode
  readonly value?: string
}

export interface ParsedArgs {
  readonly [key: string]: string | boolean | readonly string[] | readonly ArgIssue[] | undefined
  /** Every token the spec rejected, classified so the command can report a precise usage error. */
  readonly issues: readonly ArgIssue[]
  readonly rest?: string
}

interface ReadFlagContext {
  readonly argv: readonly string[]
  readonly index: number
  readonly token: string
  readonly spec: Spec
  readonly byAlias: ReadonlyMap<string, string>
  readonly out: Record<string, string | boolean | readonly string[] | undefined>
  readonly issues: ArgIssue[]
}

interface StoredFlag {
  readonly name: string
  readonly value: string
  readonly flag: FlagSpec
}

interface IntFlagMissing {
  readonly kind: 'missing'
}

interface IntFlagValue {
  readonly kind: 'value'
  readonly value: number
}

interface IntFlagError {
  readonly kind: 'error'
  readonly error: LocalizedText
}

type IntFlagResult = IntFlagMissing | IntFlagValue | IntFlagError

// Flags are kebab-case on the command line and camelCase in code: --max-turns -> args.maxTurns.
export function parseArgs(argv: readonly string[], spec: Spec): ParsedArgs {
  const out: Record<string, string | boolean | readonly string[] | undefined> = {}
  const issues: ArgIssue[] = []
  const positionals: string[] = []
  const byAlias = aliasMap(spec)
  let rest: string | undefined
  let index = 0

  while (index < argv.length) {
    const token = argv[index]

    if (token === undefined) {
      break
    }

    if (token === END_OF_OPTIONS) {
      const tail = argv.slice(index + 1)

      if (spec.separator === END_OF_OPTIONS) {
        rest = tail.join(' ')
      } else {
        positionals.push(...tail)
      }

      break
    }

    const consumed = readFlag({ argv, index, token, spec, byAlias, out, issues })

    if (consumed > 0) {
      index += consumed
      continue
    }

    // A dash-prefixed token that no flag consumed is a typo, not a positional argument.
    if (isFlagLike(token)) {
      issues.push({ token, code: 'unknown_flag' })
      index += 1

      continue
    }

    positionals.push(token)
    index += 1
  }

  assignPositionals(out, { spec, positionals, issues })

  return { ...out, issues, ...(rest === undefined ? {} : { rest }) }
}

function isFlagLike(token: string): boolean {
  return token.startsWith('-') && !NEGATIVE_NUMBER_RE.test(token)
}

// Boolean inline values accept only exact `true` and `false`; an absent inline value means true.
// Any other inline text is a usage error so `--yes=false` cannot be silently ignored.
function parseBooleanValue(inline: string | undefined): boolean | null {
  if (inline === undefined) {
    return true
  }

  if (inline === 'true') {
    return true
  }

  if (inline === 'false') {
    return false
  }

  return null
}

function readFlag(ctx: ReadFlagContext): number {
  const parsed = flagNameAndInlineValue(ctx.token, ctx.byAlias)

  if (parsed === null) {
    return 0
  }

  const { name, inline } = parsed
  const flags = ctx.spec.flags
  const flag = flags !== undefined && Object.hasOwn(flags, name) ? flags[name] : undefined

  if (flag === undefined) {
    ctx.issues.push({ token: ctx.token, code: 'unknown_flag' })

    return 1
  }

  if (flag.type === 'boolean') {
    return readBooleanFlag(ctx, name, inline)
  }

  return readStringFlag(ctx, { name, inline, flag })
}

function readBooleanFlag(ctx: ReadFlagContext, name: string, inline: string | undefined): number {
  const value = parseBooleanValue(inline)

  if (value === null) {
    ctx.issues.push({ token: ctx.token, code: 'invalid_choice', value: inline ?? '' })

    return 1
  }

  ctx.out[name] = value

  return 1
}

function readStringFlag(
  ctx: ReadFlagContext,
  flag: { readonly name: string; readonly inline: string | undefined; readonly flag: FlagSpec }
): number {
  const { name, inline, flag: spec } = flag
  const value = inline ?? ctx.argv[ctx.index + 1]

  if (value === undefined || value === '') {
    ctx.issues.push({ token: ctx.token, code: 'missing_value' })

    return 1
  }

  if (inline === undefined && isFlagLike(value)) {
    ctx.issues.push({ token: ctx.token, code: 'missing_value' })

    return 1
  }

  if (spec.choices !== undefined && !spec.choices.includes(value)) {
    ctx.issues.push({ token: ctx.token, code: 'invalid_choice', value })

    return inline === undefined ? 2 : 1
  }

  store(ctx.out, { name, value, flag: spec })

  return inline === undefined ? 2 : 1
}

function flagNameAndInlineValue(
  token: string,
  byAlias: ReadonlyMap<string, string>
): { readonly name: string; readonly inline?: string } | null {
  const long = LONG_FLAG_RE.exec(token)

  if (long?.[1] !== undefined) {
    const name = toCamel(long[1])

    return long[2] === undefined ? { name } : { name, inline: long[2] }
  }

  const short = SHORT_FLAG_RE.exec(token)
  const aliased = short?.[1] === undefined ? undefined : byAlias.get(short[1])

  return aliased === undefined ? null : { name: aliased }
}

function store(
  out: Record<string, string | boolean | readonly string[] | undefined>,
  stored: StoredFlag
): void {
  const { name, value, flag } = stored

  if (!flag.multi) {
    out[name] = value

    return
  }

  const previous = out[name]
  const existing = Array.isArray(previous) ? previous : []

  // Both spellings compose: --tag=a,b --tag c yields three tags.
  out[name] = [...existing, ...value.split(',').filter((part) => part !== '')]
}

function assignPositionals(
  out: Record<string, string | boolean | readonly string[] | undefined>,
  options: {
    readonly spec: Spec
    readonly positionals: readonly string[]
    readonly issues: ArgIssue[]
  }
): void {
  const names = options.spec.positional ?? []

  for (const [slot, name] of names.entries()) {
    const value = options.positionals[slot]

    if (value !== undefined) {
      out[toCamel(name)] = value
    } else if (!options.spec.positionalOptional) {
      options.issues.push({ token: name, code: 'missing_positional' })
    }
  }

  const extra = options.positionals.slice(names.length)
  const rest = options.spec.positionalRest

  if (rest !== undefined) {
    out[toCamel(rest)] = extra

    return
  }

  // Extras beyond the named slots are a usage error, never silently consumed.
  for (const token of extra) {
    options.issues.push({ token, code: 'extra_positional' })
  }
}

function aliasMap(spec: Spec): ReadonlyMap<string, string> {
  const pairs = Object.entries(spec.flags ?? {}).flatMap(([name, flag]) =>
    flag.alias === undefined ? [] : [[flag.alias, name] as const]
  )

  return new Map(pairs)
}

function toCamel(name: string): string {
  return name.replace(KEBAB_BOUNDARY_RE, (_whole, char: string) => char.toUpperCase())
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args[name]

  return typeof value === 'string' ? value : undefined
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args[name] === true
}

export function flagList(args: ParsedArgs, name: string): readonly string[] {
  const value = args[name]

  return Array.isArray(value) ? value : []
}

// These flags name counts and limits, so a negative is a usage error, not a value to pass down:
// a malformed value is reported to the user, never silently ignored.
export function parseIntFlagStrict(raw: string | undefined, flag: string): IntFlagResult {
  if (raw === undefined || raw === '') {
    return { kind: 'missing' }
  }

  const value = Number(raw)

  // `Number()` alone also takes `0x10`, `1e3` and padded input, turning a typo into a real count.
  return DECIMAL_INT_RE.test(raw) && isCount(value)
    ? { kind: 'value', value }
    : { kind: 'error', error: { key: 'cli.flagNotCount', params: { flag, value: raw } } }
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}
