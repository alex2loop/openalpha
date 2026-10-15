import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { abortError, ToolError } from '@/core/errors'
import { isBinaryContent } from '@/core/security/binary'
import { FILE_MAX_BYTES } from '@/tools/fs/limits'

const FILE_VERSION_ALGORITHM = 'sha256'

interface FileSnapshot {
  readonly text: string
  readonly version: string
}

export async function readFileSnapshot(
  handle: FileHandle,
  signal: AbortSignal
): Promise<FileSnapshot> {
  if (signal.aborted) {
    return Promise.reject(abortError(signal))
  }

  const before = await handle.stat()
  assertReadActive(signal)

  if (!before.isFile()) {
    throw new ToolError('invalid_input', 'path is not a file')
  }

  if (before.size > FILE_MAX_BYTES) {
    throw new ToolError(
      'payload_too_large',
      `file size ${before.size} exceeds cap ${FILE_MAX_BYTES}`
    )
  }

  const content = Buffer.alloc(before.size)
  const bytesRead = await readContent(handle, content, signal)
  const after = await handle.stat()
  assertReadActive(signal)

  assertStableRead(before, after, bytesRead)

  if (isBinaryContent(content)) {
    throw new ToolError('binary_content', 'binary file detected — only text files are supported')
  }

  return {
    text: content.toString('utf8'),
    version: toFileVersion(content),
  }
}

export function toFileVersion(content: string | Uint8Array): string {
  return createHash(FILE_VERSION_ALGORITHM).update(content).digest('hex')
}

async function readContent(
  handle: FileHandle,
  content: Buffer,
  signal: AbortSignal
): Promise<number> {
  let offset = 0

  while (offset < content.length) {
    if (signal.aborted) {
      throw abortError(signal)
    }

    const { bytesRead } = await handle.read(content, offset, content.length - offset, offset)
    assertReadActive(signal)

    if (bytesRead === 0) {
      break
    }

    offset += bytesRead
  }

  return offset
}

function assertReadActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}

function assertStableRead(before: Stats, after: Stats, bytesRead: number): void {
  if (
    bytesRead !== before.size ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    throw new ToolError('invalid_input', 'file changed while being read')
  }
}
