import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { DisplayText } from '@/core/stream-events'
import type { WalkEntry } from '@/tools/fs/walk-files'
import { ToolError } from '@/core/errors'
import { PathPolicy } from '@/core/security/path-policy'
import { createTool } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'
import { GLOB_MAX_LENGTH, isGlobMatch } from '@/core/utils/glob'
import { readDirPinned } from '@/tools/fs/read-dir'
import { walkFiles } from '@/tools/fs/walk-files'
import { zeroOrEmptyToUndef } from '@/tools/schema'
import { toSummaryJson } from '@/tools/summary'

const FILE_LIST_MAX_ENTRIES = 1_000
const FILE_LIST_DEFAULT_MAX_DEPTH = 3
// Truthful for either walk bound: the file cap may not have been the one that stopped traversal.
const TRAVERSAL_TRUNCATED_MARKER = '[truncated: traversal limit reached; results are partial]'

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Workspace-relative or absolute path of the directory to list. ' +
        'Must be a directory, not a file.'
    ),
  glob: z
    .string()
    .max(GLOB_MAX_LENGTH)
    .optional()
    .describe(
      'Optional glob pattern to filter entries by name (e.g. "*.ts", "src/**/*.json"). ' +
        'Matched against the entry name in flat mode, or relative path in recursive mode. ' +
        'When omitted all entries are returned.'
    ),
  recursive: z
    .boolean()
    .default(false)
    .describe(
      'When true, descend into subdirectories up to max_depth. ' +
        'Skips node_modules, .git, and other noisy directories. ' +
        'Symlinked directories are not followed.'
    ),
  max_depth: zeroOrEmptyToUndef(z.coerce.number().int().min(1).max(10).optional()).describe(
    'Maximum recursion depth when recursive=true. Defaults to 3. ' +
      'Increasing this on large trees may hit the 1000-entry cap sooner.'
  ),
})

type FileListArgs = z.infer<typeof inputSchema>

interface DirEntry {
  readonly name: string
  readonly type: 'file' | 'dir' | 'symlink'
  readonly size?: number
  readonly mtime?: string
}

interface ListResult {
  readonly entries: readonly DirEntry[]
  readonly truncated: boolean
}

export const fileListTool = createTool<FileListArgs>({
  name: 'file_list',
  description:
    'List files and directories in a workspace path. Returns sorted entries with type, size ' +
    '(files only), and mtime (files only). Capped at 1000 entries with truncation marker.',
  inputSchema,
  capability: 'read',
  presentation: { label: 'List files', emoji: '📁', detailKeys: ['path'] },
  summarizeResult: summarizeFileList,
  async execute(args, ctx): Promise<string> {
    const realPath = await PathPolicy.forRead(ctx.workspace).resolve(args.path)
    const dirStat = await lstat(realPath).catch(() => null)

    if (dirStat === null || !dirStat.isDirectory()) {
      throw new ToolError('invalid_input', `path is not a directory: ${args.path}`)
    }

    const { entries: rawEntries, truncated } = args.recursive
      ? await listRecursive({ realPath, workspace: ctx.workspace, args, signal: ctx.signal })
      : await listFlat({ realPath, workspace: ctx.workspace, glob: args.glob, signal: ctx.signal })
    const entries = [...rawEntries]

    if (truncated) {
      entries.push({ name: TRAVERSAL_TRUNCATED_MARKER, type: 'file' })
    }

    return JSON.stringify(entries)
  },
})

// The cap is applied while reading, so a directory with millions of entries costs 1000 of them.
// It therefore bounds directory order rather than sorted order; the marker says results are partial.
async function listFlat(options: {
  readonly realPath: string
  readonly workspace: WorkspaceIdentity
  readonly glob: string | undefined
  readonly signal: AbortSignal
}): Promise<ListResult> {
  const { glob } = options
  const { entries: dirents, truncated } = await readDirPinned({
    workspace: options.workspace,
    dirPath: options.realPath,
    limit: FILE_LIST_MAX_ENTRIES,
    signal: options.signal,
    ...(glob === undefined ? {} : { accept: (entry) => isGlobMatch(glob, entry.name) }),
  })
  const names = dirents.map((entry) => entry.name).sort()
  const entries = await Promise.all(names.map((name) => buildEntry(options.realPath, name)))

  return { entries, truncated }
}

async function listRecursive(options: {
  readonly realPath: string
  readonly workspace: WorkspaceIdentity
  readonly args: FileListArgs
  readonly signal: AbortSignal
}): Promise<ListResult> {
  const { entries: walkEntries, truncated } = await walkFiles({
    dirPath: options.realPath,
    workspace: options.workspace,
    maxDepth: options.args.max_depth ?? FILE_LIST_DEFAULT_MAX_DEPTH,
    maxFiles: FILE_LIST_MAX_ENTRIES,
    maxDirectories: FILE_LIST_MAX_ENTRIES,
    signal: options.signal,
  })
  const glob = options.args.glob
  const matching = glob ? walkEntries.filter((e) => isGlobMatch(glob, e.relPath)) : walkEntries
  const entries = matching.map((e) => buildWalkEntry(e))

  return { entries, truncated }
}

function buildWalkEntry(entry: WalkEntry): DirEntry {
  if (entry.kind === 'file') {
    return {
      name: entry.relPath,
      type: 'file',
      size: entry.size,
      mtime: new Date(entry.mtimeMs).toISOString(),
    }
  }

  if (entry.kind === 'directory') {
    return { name: entry.relPath, type: 'dir' }
  }

  return { name: entry.relPath, type: 'symlink' }
}

async function buildEntry(dirPath: string, name: string): Promise<DirEntry> {
  const stat = await lstat(join(dirPath, name))

  if (stat.isSymbolicLink()) {
    return { name, type: 'symlink' }
  }

  if (stat.isDirectory()) {
    return { name, type: 'dir' }
  }

  return { name, type: 'file', size: stat.size, mtime: stat.mtime.toISOString() }
}

function summarizeFileList(content: string): DisplayText | undefined {
  const parsed = toSummaryJson(content)

  if (Array.isArray(parsed)) {
    return countEntries(parsed.length)
  }

  if (isPlainRecord(parsed) && Array.isArray(parsed.rows)) {
    return countEntries(parsed.rows.length)
  }

  return undefined
}

function countEntries(count: number): DisplayText {
  return {
    key: count === 1 ? 'toolSummaries.fileListEntry' : 'toolSummaries.fileListEntries',
    params: { count },
  }
}
