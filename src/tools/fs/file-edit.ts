import type { FileHandle } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants, lstat, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { ToolInvocationContext } from '@/core/tool'
import type { FileRevisionGuard } from '@/tools/fs/file-revision-guard'
import { abortError, isErrno, ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PathPolicy } from '@/core/security/path-policy'
import { createTool } from '@/core/tool'
import { applyEdit } from '@/tools/fs/file-edit-match'
import { readFileSnapshot, toFileVersion } from '@/tools/fs/file-snapshot'
import { FILE_PERMISSION_MASK } from '@/tools/fs/limits'

const EDIT_DIFF_MAX_BYTES = 4_096
const SYNTAX_CHECK_TIMEOUT_MS = 10_000
const SYNTAX_WARNING_MAX_LENGTH = 200
// No '.ts': `node --check` parses with the CommonJS parser, which rejects every type annotation —
// a valid TypeScript edit would come back carrying a syntax error it does not have.
const SYNTAX_CHECK_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.mjs', '.cjs'])
const SYNTAX_ERROR_PREFIX_RE = /^.+:\s*/
const SYNTAX_FALLBACK_WARNING = 'syntax error'
const SYNTAX_INCOMPLETE_WARNING = 'syntax check did not complete'
const EDIT_TEMP_SUFFIX = '.tmp'

const execFileAsync = promisify(execFile)

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Workspace-relative or absolute path of the file to edit. Must already exist.'),
  old_text: z
    .string()
    .min(1)
    .describe(
      'Exact substring to find in the file. Must match byte-for-byte; each line of old_text has ' +
        'its leading whitespace trimmed as a fallback (fuzzy match) against the corresponding ' +
        'file line. Fails if not found, or if the fuzzy match is ambiguous (more than one alignment).'
    ),
  new_text: z
    .string()
    .describe(
      'Replacement text. Use an empty string to delete the matched region. ' +
        'Applied to all matched occurrences when replace_all=true.'
    ),
  expected_count: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe(
      'Number of occurrences of old_text expected in the file. Defaults to 1. ' +
        'Fails if the actual count differs, leaving the file unchanged. Ignored when replace_all=true.'
    ),
  replace_all: z
    .boolean()
    .default(false)
    .describe(
      'When true, replace every occurrence of old_text without checking expected_count. ' +
        'Use when you intentionally want to change all matching regions.'
    ),
})

export type FileEditArgs = z.infer<typeof inputSchema>

interface EditResult {
  replaced: number
  path: string
  diff: string
  fuzzy?: boolean
  syntax_warning?: string
}

interface EditFileInput {
  readonly realPath: string
  readonly args: FileEditArgs
  readonly workspace: WorkspaceIdentity
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  readonly fileRevisionGuard: FileRevisionGuard
  readonly logger: Logger
}

interface FileIdentity {
  readonly dev: number
  readonly ino: number
  readonly permissions: number
}

interface CommitEditInput {
  readonly handle: FileHandle
  readonly identity: FileIdentity
  readonly initialVersion: string
  readonly newContent: string
  readonly edit: EditFileInput
}

export const fileEditTool = createTool<FileEditArgs>({
  name: 'file_edit',
  description:
    'In-place edit a file by exact-string match. Fails if the number of occurrences of old_text ' +
    'does not match expected_count (default 1); the file is left unchanged on mismatch. Set ' +
    'replace_all=true to replace all occurrences without checking expected_count. Also fails if ' +
    'the file changed since this session last read or edited it. Read the file before editing.',
  inputSchema,
  capability: 'write',
  presentation: { label: 'Edit file', emoji: '✏️', detailKeys: ['path'] },
  async execute(args, ctx): Promise<string> {
    const realPath = await PathPolicy.forWrite(ctx.workspace).resolve(args.path)
    const { replaced, fuzzy } = await editFile({
      realPath,
      args,
      workspace: ctx.workspace,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
      fileRevisionGuard: ctx.services.fileRevisionGuard,
      logger: ctx.logger,
    })

    const result: EditResult = {
      replaced,
      path: realPath,
      diff: buildDiff(args.old_text, args.new_text),
    }

    if (fuzzy) {
      result.fuzzy = true
    }

    const syntaxWarning = await syntaxError(realPath, ctx)

    if (syntaxWarning !== null) {
      result.syntax_warning = syntaxWarning
    }

    return JSON.stringify(result)
  },
})

async function editFile(input: EditFileInput): Promise<{
  readonly replaced: number
  readonly fuzzy: boolean
}> {
  if (input.signal.aborted) {
    throw abortError(input.signal)
  }

  return input.fileRevisionGuard.withEditLock(input.realPath, () => editFileLocked(input))
}

async function editFileLocked(input: EditFileInput): Promise<{
  readonly replaced: number
  readonly fuzzy: boolean
}> {
  if (input.signal.aborted) {
    throw abortError(input.signal)
  }

  let handle: FileHandle | undefined
  try {
    handle = await openFile(input.realPath, input.args.path)

    await PathPolicy.assertOpenedWithin(input.workspace, handle, input.realPath)

    const initial = await readFileSnapshot(handle, input.signal)

    assertNotStale(input, initial.version)

    const { newContent, replaced, fuzzy } = applyEdit(initial.text, input.args)
    const metadata = await handle.stat()
    const identity: FileIdentity = {
      dev: metadata.dev,
      ino: metadata.ino,
      permissions: metadata.mode & FILE_PERMISSION_MASK,
    }
    const version = await commitEdit({
      handle,
      identity,
      initialVersion: initial.version,
      newContent,
      edit: input,
    })

    input.fileRevisionGuard.record(input.sessionId, input.realPath, version)
    return { replaced, fuzzy }
  } finally {
    await closeHandle(handle, input.logger, 'file_edit.close_failed')
  }
}

async function commitEdit(input: CommitEditInput): Promise<string> {
  const { edit } = input
  const beforeWrite = await readFileSnapshot(input.handle, edit.signal)

  assertSameVersion(input.initialVersion, beforeWrite.version)
  assertEditActive(edit.signal)

  const tempPath = toEditTempPath(edit.realPath)
  let tempHandle: FileHandle | undefined
  let committed = false

  try {
    tempHandle = await open(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      input.identity.permissions
    )
    await tempHandle.chmod(input.identity.permissions)
    await tempHandle.writeFile(input.newContent, { encoding: 'utf8', signal: edit.signal })
    await tempHandle.close()
    tempHandle = undefined

    const beforeCommit = await readFileSnapshot(input.handle, edit.signal)

    assertSameVersion(input.initialVersion, beforeCommit.version)
    await assertSameFileIdentity(edit.realPath, input.identity)
    assertEditActive(edit.signal)

    await rename(tempPath, edit.realPath)
    committed = true
    return toFileVersion(input.newContent)
  } finally {
    await closeHandle(tempHandle, edit.logger, 'file_edit.temp_close_failed')
    if (!committed) {
      await removeTempFile(tempPath, edit.logger)
    }
  }
}

function toEditTempPath(realPath: string): string {
  const name = `.${basename(realPath)}.${randomUUID()}${EDIT_TEMP_SUFFIX}`

  return join(dirname(realPath), name)
}

async function assertSameFileIdentity(realPath: string, expected: FileIdentity): Promise<void> {
  const current = await lstat(realPath).catch((err: unknown) => {
    throw new ToolError('invalid_input', 'file was replaced externally during edit', err)
  })

  const permissions = current.mode & FILE_PERMISSION_MASK

  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    permissions !== expected.permissions
  ) {
    throw new ToolError('invalid_input', 'file was replaced externally during edit')
  }
}

function assertEditActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}

async function closeHandle(
  handle: FileHandle | undefined,
  logger: Logger,
  event: string
): Promise<void> {
  if (handle === undefined) {
    return
  }

  try {
    await handle.close()
  } catch (err: unknown) {
    logger.warn(event, { err: formatErrForLog(err) })
  }
}

async function removeTempFile(path: string, logger: Logger): Promise<void> {
  try {
    await unlink(path)
  } catch (err: unknown) {
    if (!isErrno(err, 'ENOENT')) {
      logger.warn('file_edit.temp_remove_failed', { err: formatErrForLog(err) })
    }
  }
}

async function openFile(realPath: string, requestedPath: string): Promise<FileHandle> {
  try {
    return await open(realPath, constants.O_RDWR | constants.O_NOFOLLOW)
  } catch (err: unknown) {
    if (isErrno(err, 'ELOOP')) {
      throw new ToolError('invalid_input', 'cannot edit through symlink')
    }

    if (isErrno(err, 'ENOENT')) {
      throw new ToolError('file_not_found', `file not found: ${requestedPath}`)
    }

    if (isErrno(err, 'EISDIR')) {
      throw new ToolError('invalid_input', `path is not a file: ${requestedPath}`)
    }

    throw err
  }
}

function buildDiff(oldText: string, newText: string): string {
  const removed = oldText
    .split('\n')
    .map((l) => `-${l}`)
    .join('\n')
  const added = newText
    .split('\n')
    .map((l) => `+${l}`)
    .join('\n')
  const raw = `--- before\n+++ after\n${removed}\n${added}`

  return raw.length > EDIT_DIFF_MAX_BYTES
    ? `${raw.slice(0, EDIT_DIFF_MAX_BYTES)}\n[diff truncated]`
    : raw
}

function assertNotStale(input: EditFileInput, version: string): void {
  const known = input.fileRevisionGuard.lastKnown(input.sessionId, input.realPath)

  if (known === undefined) {
    throw new ToolError('invalid_input', 'read the file before editing')
  }

  assertSameVersion(known, version)
}

function assertSameVersion(expected: string, actual: string): void {
  if (actual !== expected) {
    throw new ToolError('invalid_input', 'file was modified externally since last read')
  }
}

// Advisory only, and it runs after the edit is committed and recorded: a check that never reaches a
// verdict reports as an inconclusive warning, never as a failed write. Throwing here would tell the
// model an applied edit did not land, and its retry would apply it a second time.
async function syntaxError(realPath: string, ctx: ToolInvocationContext): Promise<string | null> {
  const { signal } = ctx

  if (!SYNTAX_CHECK_EXTENSIONS.has(extname(realPath))) {
    return null
  }

  if (signal.aborted) {
    return SYNTAX_INCOMPLETE_WARNING
  }

  try {
    // Same env and cwd as any other agent-triggered child: the daemon's own environment carries
    // provider keys and NODE_OPTIONS, which `node --check` would honour before parsing anything.
    await execFileAsync('node', ['--check', realPath], {
      signal,
      timeout: SYNTAX_CHECK_TIMEOUT_MS,
      cwd: ctx.workspaceDir,
      env: { ...ctx.childEnv },
    })

    return null
  } catch (err: unknown) {
    if (signal.aborted || isSyntaxTimeout(err)) {
      return SYNTAX_INCOMPLETE_WARNING
    }

    const msg = err instanceof Error ? err.message : String(err)

    return (
      msg.replace(SYNTAX_ERROR_PREFIX_RE, '').slice(0, SYNTAX_WARNING_MAX_LENGTH).trim() ||
      SYNTAX_FALLBACK_WARNING
    )
  }
}

function isSyntaxTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.toLowerCase().includes('timeout') ||
      err.message.toLowerCase().includes('timed out') ||
      ('killed' in err && err.killed === true && 'signal' in err && err.signal === 'SIGTERM'))
  )
}
