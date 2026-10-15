import type { FileHandle } from 'node:fs/promises'
import { constants, open } from 'node:fs/promises'

import { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import type { WorkspaceIdentity } from '@/core/security/path-policy'
import { isErrno, ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PathPolicy } from '@/core/security/path-policy'
import { createTool } from '@/core/tool'
import { isContinuationByte } from '@/core/utils/text'
import { readFileSnapshot } from '@/tools/fs/file-snapshot'
import { zeroOrEmptyToUndef } from '@/tools/schema'

const FILE_READ_OVERSIZE_THRESHOLD = 16_384
const FILE_READ_HEAD_BYTES = 7_168
const FILE_READ_TAIL_BYTES = 2_048
const OVERSIZE_MARKER = '\n\n[... content truncated ...]\n\n'

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Workspace-relative or absolute path to the file to read. ' +
        'Must stay within the agent workspace; symlinks outside are rejected. ' +
        'Binary/image files are rejected.'
    ),
  start_line: zeroOrEmptyToUndef(z.coerce.number().int().min(1).optional()).describe(
    '1-indexed line number to start reading from (inclusive). ' +
      'When omitted the file is read from the beginning. ' +
      'Must be <= end_line when both are provided.'
  ),
  end_line: zeroOrEmptyToUndef(z.coerce.number().int().min(1).optional()).describe(
    '1-indexed line number to stop reading at (inclusive). ' +
      'When omitted reading continues to the end of the file.'
  ),
})

type FileReadArgs = z.infer<typeof inputSchema>

interface ReadRawTextInput {
  readonly realPath: string
  readonly requestedPath: string
  readonly workspace: WorkspaceIdentity
  readonly signal: AbortSignal
  readonly logger: Logger
}

interface SliceResult {
  readonly text: string
  readonly totalLines: number
  readonly linesShown: number
}

export const fileReadTool = createTool<FileReadArgs>({
  name: 'file_read',
  description:
    'Read a UTF-8 text file from the workspace. Supports optional 1-indexed inclusive line ' +
    'range via start_line/end_line. Rejects binary files and files larger than 1MB.',
  inputSchema,
  capability: 'read',
  presentation: { label: 'Read file', emoji: '📖', detailKeys: ['path'] },
  async execute(args, ctx): Promise<string> {
    if (
      args.start_line !== undefined &&
      args.end_line !== undefined &&
      args.start_line > args.end_line
    ) {
      throw new ToolError('invalid_input', 'start_line must be <= end_line')
    }

    const realPath = await PathPolicy.forRead(ctx.workspace).resolve(args.path)
    const snapshot = await readRawText({
      realPath,
      requestedPath: args.path,
      workspace: ctx.workspace,
      signal: ctx.signal,
      logger: ctx.logger,
    })
    const slice = sliceLines(snapshot.text, args.start_line, args.end_line)

    ctx.services.fileRevisionGuard.record(ctx.sessionId, realPath, snapshot.version)

    return JSON.stringify({
      content: applyHeadTailWindow(slice.text),
      total_lines: slice.totalLines,
      lines_shown: slice.linesShown,
    })
  },
})

async function readRawText(input: ReadRawTextInput): ReturnType<typeof readFileSnapshot> {
  let handle: FileHandle | undefined

  try {
    handle = await openReadFile(input.realPath, input.requestedPath)

    await PathPolicy.assertOpenedWithin(input.workspace, handle, input.realPath)

    return await readFileSnapshot(handle, input.signal)
  } finally {
    await closeReadHandle(handle, input.logger)
  }
}

async function closeReadHandle(handle: FileHandle | undefined, logger: Logger): Promise<void> {
  if (handle === undefined) {
    return
  }

  try {
    await handle.close()
  } catch (err: unknown) {
    logger.warn('file_read.close_failed', { err: formatErrForLog(err) })
  }
}

async function openReadFile(realPath: string, requestedPath: string): Promise<FileHandle> {
  try {
    // O_NONBLOCK: opening a FIFO read-only would otherwise park a threadpool thread until a writer
    // appears, with no way to abort. It is a no-op on regular files; the isFile check rejects the rest.
    return await open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (err: unknown) {
    // No sibling listing: the parent is known only by name here, and a parent swapped for an
    // external symlink since resolution would put outside names in the error.
    if (isErrno(err, 'ENOENT')) {
      throw new ToolError('file_not_found', `file not found: ${requestedPath}`)
    }

    if (isErrno(err, 'ELOOP')) {
      throw new ToolError('invalid_input', 'cannot read through symlink')
    }

    if (isErrno(err, 'EISDIR')) {
      throw new ToolError('invalid_input', `path is not a file: ${requestedPath}`)
    }

    throw err
  }
}

function sliceLines(text: string, start?: number, end?: number): SliceResult {
  const lines = text.split('\n')

  // A trailing newline terminates the last line rather than starting an empty one; counting it
  // would report one phantom line and make `end_line = total_lines` select nothing.
  if (lines.length > 1 && lines.at(-1) === '') {
    lines.pop()
  }

  const total = lines.length

  if (start === undefined && end === undefined) {
    return { text, totalLines: total, linesShown: total }
  }

  const from = Math.max(1, start ?? 1)
  const to = Math.min(total, end ?? total)

  // `from > to` means the window starts past the last line; printing it as a range would read as a
  // real region of the file.
  if (from > to) {
    return { text: `[no lines: file has ${total}]\n`, totalLines: total, linesShown: 0 }
  }

  const slice = lines.slice(from - 1, to).join('\n')

  return {
    text: `[lines ${from}-${to} of ${total}]\n${slice}`,
    totalLines: total,
    linesShown: to - from + 1,
  }
}

// Head/tail byte window over an oversized slice — a coarse pre-cut before the executor's own
// output pipeline caps the final result. Returns the text unchanged when it already fits.
function applyHeadTailWindow(text: string): string {
  const byteLen = Buffer.byteLength(text, 'utf8')

  if (byteLen <= FILE_READ_OVERSIZE_THRESHOLD) {
    return text
  }

  const buf = Buffer.from(text, 'utf8')
  const headEnd = alignBack(buf, FILE_READ_HEAD_BYTES)
  const tailStart = alignForward(buf, byteLen - FILE_READ_TAIL_BYTES)
  const head = buf.subarray(0, headEnd).toString('utf8')
  const tail = buf.subarray(tailStart).toString('utf8')

  return head + OVERSIZE_MARKER + tail
}

function alignBack(buf: Uint8Array, offset: number): number {
  let i = Math.min(offset, buf.length)
  while (i > 0 && i < buf.length && isContinuationByte(buf[i])) {
    i -= 1
  }
  return i
}

function alignForward(buf: Uint8Array, offset: number): number {
  let i = Math.max(0, Math.min(offset, buf.length))
  while (i < buf.length && isContinuationByte(buf[i])) {
    i += 1
  }
  return i
}
