import { isNoColor, isUnicode } from '@/cli/env'

const RESET = '[0m'

const CODES = {
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  cyan: '[36m',
  dim: '[2m',
  bold: '[1m',
  italic: '[3m',
} as const

const UNICODE_ICONS = {
  success: '✓',
  warn: '!',
  error: '✗',
  info: 'i',
  arrow: '→',
  bullet: '•',
  ask: '?',
  assistant: '⏺',
} as const

// A terminal without a UTF-8 locale renders the glyphs above as mojibake, so it gets ASCII.
const ASCII_ICONS = {
  success: '+',
  warn: '!',
  error: 'x',
  info: 'i',
  arrow: '->',
  bullet: '*',
  ask: '?',
  assistant: '*',
} as const satisfies Record<keyof typeof UNICODE_ICONS, string>

type ColorName = keyof typeof CODES

type ColorFns = Record<ColorName, (text: string) => string>

function paint(code: string): (text: string) => string {
  // Decided per call: one process may write to both a TTY and a pipe.
  return (text) => (isNoColor() ? text : `${code}${text}${RESET}`)
}

export const colors: ColorFns = {
  red: paint(CODES.red),
  green: paint(CODES.green),
  yellow: paint(CODES.yellow),
  blue: paint(CODES.blue),
  cyan: paint(CODES.cyan),
  dim: paint(CODES.dim),
  bold: paint(CODES.bold),
  italic: paint(CODES.italic),
}

export const style = {
  error: colors.red,
  success: colors.green,
  warn: colors.yellow,
  accent: colors.cyan,
  muted: colors.dim,
  heading: colors.bold,
  italic: colors.italic,
  title: (text: string): string => colors.bold(colors.cyan(text)),
}

export function icons(): Record<keyof typeof UNICODE_ICONS, string> {
  return isUnicode() ? UNICODE_ICONS : ASCII_ICONS
}

export function success(msg: string): string {
  return `${style.success(icons().success)} ${msg}`
}

export function fail(msg: string): string {
  return `${style.error(icons().error)} ${msg}`
}

export function warn(msg: string): string {
  return `${style.warn(icons().warn)} ${msg}`
}

export function info(msg: string): string {
  return `${style.accent(icons().info)} ${msg}`
}

export function hint(msg: string): string {
  return style.muted(msg)
}

export function ask(question: string): string {
  return `${style.accent(icons().ask)} ${question}`
}
