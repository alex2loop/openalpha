import { z } from 'zod'

import { ToolError } from '@/core/errors'
import { createTool } from '@/core/tool'

const CALC_MAX_EXPRESSION_LEN = 200

const CONSTANTS: Readonly<Record<string, number>> = Object.freeze({
  pi: Math.PI,
  e: Math.E,
})

interface FunctionSpec {
  readonly minArgs: number
  readonly maxArgs?: number
  readonly evaluate: (args: readonly number[]) => number
}

const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = Object.freeze({
  abs: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.abs(value) },
  sqrt: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.sqrt(value) },
  round: {
    minArgs: 1,
    maxArgs: 1,
    evaluate: ([value = Number.NaN]) => roundHalfAwayFromZero(value),
  },
  floor: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.floor(value) },
  ceil: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.ceil(value) },
  ln: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.log(value) },
  log10: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.log10(value) },
  exp: { minArgs: 1, maxArgs: 1, evaluate: ([value = Number.NaN]) => Math.exp(value) },
  min: { minArgs: 1, evaluate: (values) => Math.min(...values) },
  max: { minArgs: 1, evaluate: (values) => Math.max(...values) },
  pow: {
    minArgs: 2,
    maxArgs: 2,
    evaluate: ([base = Number.NaN, exponent = Number.NaN]) => base ** exponent,
  },
})

const PLAIN_OPERATORS = Object.freeze(['+', '-', '/', '%', '^'])
const WHITESPACE_RE = /\s/
const NUMBER_RE = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?/y
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/y

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'operator'; readonly value: string }
  | { readonly kind: 'identifier'; readonly value: string }
  | { readonly kind: 'left-paren' }
  | { readonly kind: 'right-paren' }
  | { readonly kind: 'comma' }

interface Cursor {
  readonly tokens: readonly Token[]
  position: number
}

export const calcTool = createTool({
  name: 'calc',
  description:
    'Evaluate an arithmetic expression and return the result. Use for reliable math instead of computing in your head. Supports + - * / % ^ **, parentheses, abs/sqrt/round/floor/ceil/ln/log10/exp/min/max/pow, pi/e. No variables.',
  inputSchema: z.object({
    expression: z
      .string()
      .min(1)
      .max(CALC_MAX_EXPRESSION_LEN)
      .describe(
        'Arithmetic to evaluate, such as "1250 * 0.02" or "(340 - 310) / 310 * 100". Numbers only; no currency symbols or thousands separators.'
      ),
  }),
  capability: 'read',
  presentation: { label: 'Calculate', emoji: '🧮', detailKeys: ['expression'] },
  // Eager because the model does not know it needs help: it is confident it can do arithmetic, so
  // it never reaches for tool_search, and a wrong number reads exactly like a right one.
  eager: true,
  async execute(args): Promise<string> {
    return String(evaluateExpression(args.expression))
  },
})

function evaluateExpression(src: string): number {
  const cursor: Cursor = { tokens: tokenize(src), position: 0 }

  if (cursor.tokens.length === 0) {
    throwInvalidExpression()
  }

  const result = parseExpression(cursor)

  if (cursor.position !== cursor.tokens.length) {
    throwInvalidExpression()
  }

  return result
}

// Checked at every step: an intermediate Infinity would otherwise be absorbed by a later operation
// (1/10^999 is 0, min(10^999, 5) is 5) and the model would read the wrong number as right.
function finite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new ToolError('invalid_input', 'arithmetic result must be finite')
  }

  return value
}

function assertNonZeroDivisor(divisor: number): void {
  if (divisor === 0) {
    throw new ToolError('invalid_input', 'division by zero')
  }
}

function tokenize(src: string): readonly Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < src.length) {
    if (WHITESPACE_RE.test(src.charAt(i))) {
      i++
      continue
    }

    const { token, len } = scanToken(src, i)

    tokens.push(token)
    i += len
  }

  return tokens
}

function scanToken(src: string, i: number): { token: Token; len: number } {
  const ch = src.charAt(i)

  if (ch === '(') {
    return { token: { kind: 'left-paren' }, len: 1 }
  }

  if (ch === ')') {
    return { token: { kind: 'right-paren' }, len: 1 }
  }

  if (ch === ',') {
    return { token: { kind: 'comma' }, len: 1 }
  }

  if (PLAIN_OPERATORS.includes(ch)) {
    return { token: { kind: 'operator', value: ch }, len: 1 }
  }

  if (ch === '*') {
    const power = src[i + 1] === '*'

    return { token: { kind: 'operator', value: power ? '^' : '*' }, len: power ? 2 : 1 }
  }

  const num = scanSticky(NUMBER_RE, src, i)

  if (num !== undefined) {
    return { token: { kind: 'number', value: Number(num) }, len: num.length }
  }

  const id = scanSticky(IDENTIFIER_RE, src, i)

  if (id !== undefined) {
    return { token: { kind: 'identifier', value: id }, len: id.length }
  }

  throwInvalidExpression()
}

function scanSticky(re: RegExp, src: string, i: number): string | undefined {
  re.lastIndex = i
  const match = re.exec(src)

  return match ? match[0] : undefined
}

function parseExpression(cursor: Cursor): number {
  let acc = parseTerm(cursor)
  let op = cursor.tokens[cursor.position]

  while (op?.kind === 'operator' && (op.value === '+' || op.value === '-')) {
    cursor.position++
    const rhs = parseTerm(cursor)

    acc = finite(op.value === '+' ? acc + rhs : acc - rhs)
    op = cursor.tokens[cursor.position]
  }

  return acc
}

function parseTerm(cursor: Cursor): number {
  let acc = parseUnary(cursor)
  let op = cursor.tokens[cursor.position]

  while (op?.kind === 'operator' && (op.value === '*' || op.value === '/' || op.value === '%')) {
    cursor.position++
    const rhs = parseUnary(cursor)

    if (op.value === '*') {
      acc = finite(acc * rhs)
    } else {
      assertNonZeroDivisor(rhs)
      acc = finite(op.value === '/' ? acc / rhs : acc % rhs)
    }

    op = cursor.tokens[cursor.position]
  }

  return acc
}

function parseUnary(cursor: Cursor): number {
  const tok = cursor.tokens[cursor.position]

  if (tok?.kind === 'operator' && (tok.value === '+' || tok.value === '-')) {
    cursor.position++
    const operand = parseUnary(cursor)

    return tok.value === '-' ? -operand : operand
  }

  return parsePower(cursor)
}

// Power binds tighter than unary and is right-associative (2^3^2 = 512; 2^-2 = 0.25).
function parsePower(cursor: Cursor): number {
  const base = parsePrimary(cursor)
  const op = cursor.tokens[cursor.position]

  if (op?.kind === 'operator' && op.value === '^') {
    cursor.position++

    return finite(base ** parseUnary(cursor))
  }

  return base
}

function parsePrimary(cursor: Cursor): number {
  const tok = cursor.tokens[cursor.position]

  if (!tok) {
    throwInvalidExpression()
  }

  if (tok.kind === 'number') {
    cursor.position++

    return finite(tok.value)
  }

  if (tok.kind === 'left-paren') {
    return parseParenthesized(cursor)
  }

  if (tok.kind === 'identifier') {
    return parseIdentifier(cursor)
  }

  throwInvalidExpression()
}

function parseParenthesized(cursor: Cursor): number {
  cursor.position++

  const inner = parseExpression(cursor)

  if (cursor.tokens[cursor.position]?.kind !== 'right-paren') {
    throwInvalidExpression()
  }

  cursor.position++

  return inner
}

function parseIdentifier(cursor: Cursor): number {
  const tok = cursor.tokens[cursor.position]

  if (tok?.kind !== 'identifier') {
    throwInvalidExpression()
  }

  const name = tok.value

  cursor.position++

  if (cursor.tokens[cursor.position]?.kind === 'left-paren') {
    cursor.position++
    const args = parseArguments(cursor)

    if (cursor.tokens[cursor.position]?.kind !== 'right-paren') {
      throwInvalidExpression()
    }

    cursor.position++

    if (!Object.hasOwn(FUNCTIONS, name)) {
      throwInvalidExpression()
    }

    const spec = FUNCTIONS[name]

    if (
      spec === undefined ||
      args.length < spec.minArgs ||
      (spec.maxArgs !== undefined && args.length > spec.maxArgs)
    ) {
      throwInvalidExpression()
    }

    return finite(spec.evaluate(args))
  }

  if (!Object.hasOwn(CONSTANTS, name)) {
    throwInvalidExpression()
  }

  const value = CONSTANTS[name]

  if (value === undefined) {
    throwInvalidExpression()
  }

  return value
}

function parseArguments(cursor: Cursor): number[] {
  const args: number[] = []

  if (cursor.tokens[cursor.position]?.kind === 'right-paren') {
    return args
  }

  args.push(parseExpression(cursor))

  while (cursor.tokens[cursor.position]?.kind === 'comma') {
    cursor.position++
    args.push(parseExpression(cursor))
  }

  return args
}

function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

function throwInvalidExpression(): never {
  throw new ToolError('invalid_input', 'invalid arithmetic expression')
}
