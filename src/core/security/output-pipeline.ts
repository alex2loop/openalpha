import { scrubCredentials } from '@/core/security/credentials'
import { escapeXml, scanOutput, type Threat, wrapToolResult } from '@/core/security/sanitize'
import { estimateTextTokens } from '@/core/stream-events'
import { isPlainRecord } from '@/core/utils/collections'
import { isContinuationByte, reduceOutput, stripAnsi } from '@/core/utils/text'

/** Of a capped result, the share kept from the start and from the end; the rest is the marker's. */
const HEAD_SHARE = 0.7
const TAIL_SHARE = 0.2
/** A raw result is scrubbed and scanned whole, since a secret straddling any cut would leak. Above
 *  this the regex passes cost more than the result is worth (they run about 50 ms per MiB), and no
 *  built-in tool returns more than about 2 MiB; only a remote server can, so it is dropped unread. */
const RAW_SCRUB_MAX_BYTES = 4_194_304
const STRUCTURED_INPUT_MAX_BYTES = 65_536
const STRUCTURED_MAX_DEPTH = 2
const STRUCTURED_MIN_ROWS = 3
const STRUCTURED_MAX_ROWS = 200
const STRUCTURED_MAX_COLUMNS = 32
const STRUCTURED_CELL_MAX_BYTES = 2_048
const STRUCTURED_MAX_TOKEN_GROWTH_PCT = 5

interface ToolResultContent {
  readonly text: string
  readonly truncated: boolean
  readonly threats: readonly Threat[]
}

interface ProcessOptions {
  readonly toolName: string
  readonly maxBytes: number
}

interface CappedText {
  readonly text: string
  readonly truncated: boolean
}

type JsonScalar = boolean | number | string | null

function process(raw: string, options: ProcessOptions): ToolResultContent {
  const rawBytes = Buffer.byteLength(raw, 'utf8')

  if (rawBytes > RAW_SCRUB_MAX_BYTES) {
    return toOversizeResult(rawBytes, options.toolName)
  }

  // Scrub before any cut: a PEM block or token straddling it would keep its body.
  const scrubbed = scrubCredentials(stripAnsi(raw))
  // Scan before deriving a smaller view so compaction cannot hide an injection.
  const threats = scanOutput(scrubbed)
  const escaped = escapeXml(normalizeOutput(scrubbed))
  // Escaping grows a result up to fivefold, so it is capped escaped and net of the envelope it
  // travels in: what reaches the model is at most `maxBytes`.
  const envelopeBytes = Buffer.byteLength(wrapToolResult('', options.toolName, threats), 'utf8')
  const capped = headTailCap(escaped, Math.max(0, options.maxBytes - envelopeBytes))

  return {
    text: wrapToolResult(capped.text, options.toolName, threats),
    truncated: capped.truncated,
    threats,
  }
}

function toOversizeResult(rawBytes: number, toolName: string): ToolResultContent {
  const marker = `[dropped ${rawBytes} bytes: too large to scrub]`

  return { text: wrapToolResult(marker, toolName, []), truncated: true, threats: [] }
}

function normalizeOutput(text: string): string {
  const structured = compactStructured(text)

  if (structured !== undefined) {
    return structured
  }

  // reduceOutput before byte-cap so truncation markers aren't themselves compacted away.
  return reduceOutput(text)
}

function compactStructured(text: string): string | undefined {
  const trimmed = text.trim()

  if (!trimmed.startsWith('[')) {
    return undefined
  }

  if (Buffer.byteLength(text, 'utf8') > STRUCTURED_INPUT_MAX_BYTES) {
    return text
  }

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return text
  }

  if (!hasAllowedDepth(value, 0)) {
    return text
  }

  const candidate = toStructuredTable(value)

  if (candidate === undefined || !isWithinStructuredGrowth(text, candidate)) {
    return text
  }

  return candidate
}

function toStructuredTable(value: unknown): string | undefined {
  if (
    !Array.isArray(value) ||
    value.length < STRUCTURED_MIN_ROWS ||
    value.length > STRUCTURED_MAX_ROWS
  ) {
    return undefined
  }

  const first = value[0]

  if (!isPlainRecord(first)) {
    return undefined
  }

  const columns = Object.keys(first)

  if (columns.length === 0 || columns.length > STRUCTURED_MAX_COLUMNS) {
    return undefined
  }

  const rows = toScalarRows(value, columns)

  if (rows === undefined) {
    return undefined
  }

  return JSON.stringify({ columns, rows })
}

function toScalarRows(
  values: readonly unknown[],
  columns: readonly string[]
): readonly (readonly JsonScalar[])[] | undefined {
  const rows: JsonScalar[][] = []
  for (const value of values) {
    if (!hasExactColumns(value, columns)) {
      return undefined
    }

    const row: JsonScalar[] = []
    for (const column of columns) {
      const cell = value[column]

      if (!isBoundedScalar(cell)) {
        return undefined
      }
      row.push(cell)
    }
    rows.push(row)
  }

  return rows
}

function hasExactColumns(
  value: unknown,
  columns: readonly string[]
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false
  }

  const keys = Object.keys(value)

  return keys.length === columns.length && keys.every((key, index) => key === columns[index])
}

function isWithinStructuredGrowth(original: string, candidate: string): boolean {
  const originalTokens = estimateTextTokens(original)
  const candidateTokens = estimateTextTokens(candidate)

  return candidateTokens * 100 <= originalTokens * (100 + STRUCTURED_MAX_TOKEN_GROWTH_PCT)
}

function isBoundedScalar(value: unknown): value is JsonScalar {
  return (
    isExactScalar(value) &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <= STRUCTURED_CELL_MAX_BYTES
  )
}

function isExactScalar(value: unknown): value is JsonScalar {
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0)
  }

  return value === null || typeof value === 'string' || typeof value === 'boolean'
}

function hasAllowedDepth(value: unknown, depth: number): boolean {
  if (depth > STRUCTURED_MAX_DEPTH) {
    return false
  }

  if (isExactScalar(value)) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((entry) => hasAllowedDepth(entry, depth + 1))
  }

  if (isPlainRecord(value)) {
    return Object.values(value).every((entry) => hasAllowedDepth(entry, depth + 1))
  }

  return false
}

// Head-tail window over UTF-8 bytes: returns pieces when total exceeds maxBytes.
function headTailCap(text: string, maxBytes: number): CappedText {
  const byteLen = Buffer.byteLength(text, 'utf8')

  if (byteLen <= maxBytes) {
    return { text, truncated: false }
  }

  const buf = Buffer.from(text, 'utf8')
  const headEnd = alignToUtf8Start(buf, Math.floor(maxBytes * HEAD_SHARE))
  const tailStart = findUtf8Start(buf, byteLen - Math.floor(maxBytes * TAIL_SHARE))
  const head = buf.subarray(0, headEnd).toString('utf8')
  const tail = buf.subarray(tailStart).toString('utf8')
  const dropped = tailStart - headEnd

  return {
    text: `${head}\n[truncated ${dropped} bytes]\n${tail}`,
    truncated: true,
  }
}

function alignToUtf8Start(buf: Uint8Array, offset: number): number {
  let i = Math.min(offset, buf.length)
  while (i > 0 && i < buf.length && isContinuationByte(buf[i])) {
    i--
  }
  return i
}

function findUtf8Start(buf: Uint8Array, offset: number): number {
  let i = Math.max(0, Math.min(offset, buf.length))
  while (i < buf.length && isContinuationByte(buf[i])) {
    i++
  }
  return i
}

export const OutputPipeline = {
  process,
} as const
