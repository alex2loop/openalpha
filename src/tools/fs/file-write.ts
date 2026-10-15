import type { FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chmod, constants, lstat, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { ToolInvocationContext } from '@/core/tool'
import { abortError, isErrno, ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PathPolicy } from '@/core/security/path-policy'
import { createTool } from '@/core/tool'
import { readFileSnapshot, toFileVersion } from '@/tools/fs/file-snapshot'
import { FILE_PERMISSION_MASK } from '@/tools/fs/limits'

const FILE_WRITE_MAX_BYTES = 5_242_880
const NEW_FILE_MODE = 0o644

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Workspace-relative or absolute path of the file to write. ' +
        'Parent directories are created automatically. ' +
        'Symlinks and protected files (CLAUDE.md, AGENTS.md, CONTEXT.md) are rejected.'
    ),
  content: z
    .string()
    .describe(
      'UTF-8 text to write. Maximum 5 MB. ' +
        'For append mode this text is added to the end of the existing content.'
    ),
  mode: z
    .enum(['overwrite', 'append', 'create'])
    .default('overwrite')
    .describe(
      'Write mode. "overwrite" replaces the file (default). "append" adds to the end. ' +
        '"create" fails with an error if the file already exists.'
    ),
})

type FileWriteArgs = z.infer<typeof inputSchema>

interface WriteContext {
  readonly workspace: WorkspaceIdentity
  readonly signal: AbortSignal
}

export const fileWriteTool = createTool<FileWriteArgs>({
  name: 'file_write',
  description:
    'Write UTF-8 text to a file in the workspace. Modes: overwrite (default), append, create ' +
    '(fails if file exists). Protected files (CLAUDE.md, AGENTS.md, CONTEXT.md) cannot be written.',
  inputSchema,
  capability: 'write',
  presentation: { label: 'Write file', emoji: '✏️', detailKeys: ['path'] },
  async execute(args, ctx): Promise<string> {
    const resolver = PathPolicy.forWrite(ctx.workspace)

    // Resolve + run protected/sensitive/escape checks BEFORE any mkdir, so a pre-existing symlink
    // in the parent chain cannot trick us into creating directories outside the workspace.
    const realPath = await resolver.resolve(args.path)

    // Reject an existing symlink at the leaf; O_NOFOLLOW below catches a concurrent swap after mkdir.
    await assertNotSymlink(resolve(ctx.workspace.path, args.path))

    await mkdir(dirname(realPath), { recursive: true })

    // Re-resolve after mkdir to catch a TOCTOU symlink swap during directory creation.
    const verified = await resolver.resolve(args.path)

    if (verified !== realPath) {
      throw new ToolError('path_escape', `path ${args.path} changed during directory creation`)
    }

    const bytesWritten = await writeThroughHandle(realPath, args, {
      workspace: ctx.workspace,
      signal: ctx.signal,
    })

    await recordWrittenVersion(realPath, args, ctx)

    return JSON.stringify({ path: realPath, bytes_written: bytesWritten })
  },
})

// Overwrite has no flag entry: it lands in a create-exclusive temp file and renames over the
// destination, so an abort or failed write never leaves the original truncated or partial.
const MODE_FLAGS: Readonly<Record<'append' | 'create', number>> = {
  append: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
  // O_EXCL is atomic create-exclusive — eliminates the create-mode TOCTOU race.
  create: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
}

// realpath (inside PathPolicy) silently follows a symlink at the leaf, so an explicit lstat
// rejects an existing symlink before mkdir. O_NOFOLLOW in writeThroughHandle catches a swap
// that happens after this check.
async function assertNotSymlink(requestedAbs: string): Promise<void> {
  const leafStat = await lstat(requestedAbs).catch((err: unknown) => {
    if (isErrno(err, 'ENOENT')) {
      return null
    }

    throw err
  })

  if (leafStat?.isSymbolicLink()) {
    throw new ToolError('invalid_input', 'cannot write through symlink')
  }
}

// Without this the session's next file_edit reports its own write as an external modification.
async function recordWrittenVersion(
  realPath: string,
  args: FileWriteArgs,
  ctx: ToolInvocationContext
): Promise<void> {
  const { fileRevisionGuard } = ctx.services

  if (args.mode !== 'append') {
    fileRevisionGuard.record(ctx.sessionId, realPath, toFileVersion(args.content))

    return
  }

  // An append leaves the whole file's version unknown without a re-read. The write has landed by
  // now, so a failed re-read (file now over the read cap, abort) only leaves the version unrecorded.
  try {
    const version = await readAppendedVersion(realPath, ctx)

    fileRevisionGuard.record(ctx.sessionId, realPath, version)
  } catch (err: unknown) {
    ctx.logger.warn('file_write.revision_unrecorded', { err: formatErrForLog(err) })
  }
}

async function readAppendedVersion(realPath: string, ctx: ToolInvocationContext): Promise<string> {
  let handle: FileHandle | undefined

  try {
    handle = await open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW)

    await PathPolicy.assertOpenedWithin(ctx.workspace, handle, realPath)

    return (await readFileSnapshot(handle, ctx.signal)).version
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function writeThroughHandle(
  realPath: string,
  args: FileWriteArgs,
  write: WriteContext
): Promise<number> {
  const bytes = Buffer.byteLength(args.content, 'utf8')

  if (bytes > FILE_WRITE_MAX_BYTES) {
    throw new ToolError(
      'payload_too_large',
      `content size ${bytes} exceeds cap ${FILE_WRITE_MAX_BYTES}`
    )
  }

  if (write.signal.aborted) {
    throw abortError(write.signal)
  }

  try {
    if (args.mode === 'overwrite') {
      await replaceViaTemp(realPath, args.content, write)
    } else {
      await writeWithFlags(realPath, args.content, { flags: MODE_FLAGS[args.mode], write })
    }

    return bytes
  } catch (err: unknown) {
    if (isErrno(err, 'ELOOP')) {
      throw new ToolError('invalid_input', 'cannot write through symlink')
    }

    if (isErrno(err, 'EEXIST')) {
      throw new ToolError('invalid_input', 'file already exists; use mode=overwrite to replace')
    }

    throw err
  }
}

async function replaceViaTemp(
  realPath: string,
  content: string,
  write: WriteContext
): Promise<void> {
  const tempPath = join(dirname(realPath), `.${basename(realPath)}.${randomUUID()}.tmp`)
  const original = await stat(realPath).catch((err: unknown) => {
    if (isErrno(err, 'ENOENT')) {
      return null
    }

    throw err
  })

  try {
    await writeWithFlags(tempPath, content, { flags: MODE_FLAGS.create, write })

    // chmod, not open(mode): the umask would strip bits from a mode passed at open time, so a new
    // file's permissions would otherwise depend on the operator's umask.
    await chmod(tempPath, original === null ? NEW_FILE_MODE : original.mode & FILE_PERMISSION_MASK)

    await rename(tempPath, realPath)
  } catch (err: unknown) {
    await unlink(tempPath).catch(() => undefined)
    throw err
  }
}

async function writeWithFlags(
  path: string,
  content: string,
  options: { readonly flags: number; readonly write: WriteContext }
): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, options.flags)

    await PathPolicy.assertOpenedWithin(options.write.workspace, handle, path)
    await handle.writeFile(content, { encoding: 'utf8', signal: options.write.signal })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
