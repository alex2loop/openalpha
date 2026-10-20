import type { FileHandle } from 'node:fs/promises'
import { constants, lstat, open } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { DisplayText } from '@/core/stream-events'
import type { WalkFileEntry } from '@/tools/fs/walk-files'
import { isErrno, ToolError } from '@/core/errors'
import { isBinaryContent } from '@/core/security/binary'
import { PathPolicy } from '@/core/security/path-policy'
import { createTool } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'
import { GLOB_MAX_LENGTH, isGlobMatch } from '@/core/utils/glob'
import { hasBinaryExtension } from '@/tools/fs/binary'
import { walkFiles } from '@/tools/fs/walk-files'
import { emptyToUndef, zeroOrEmptyToUndef } from '@/tools/schema'
import { toSummaryJson } from '@/tools/summary'

const FILE_SEARCH_MAX_RESULTS = 50
const FILE_SEARCH_CONTEXT_LINES = 2
const FILE_SEARCH_MAX_BYTES = 1_048_576

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Case-insensitive substring to search for in file contents. ' +
        'Plain text only; no regex or glob syntax.'
    ),
  path: emptyToUndef(z.string().min(1).default('.')).describe(
    'Workspace-relative or absolute path to search within. ' +
      'Can be a directory (recursive) or a single file. Defaults to "." (the workspace root).'
  ),
  glob: z
    .string()
    .max(GLOB_MAX_LENGTH)
    .optional()
    .describe(
      'Optional glob pattern to restrict which files are searched (e.g. "*.ts", "**/*.json"). ' +
        'Matched against the file path relative to the search root. ' +
        'Binary files and files over 1 MB are always skipped.'
    ),
  context_lines: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('Number of lines to include before and after each match for context. Defaults to 2.'),
  limit: zeroOrEmptyToUndef(z.coerce.number().int().min(1).max(100).optional()).describe(
    'Maximum number of matching lines to return across all files. Defaults to 50.'
  ),
})

type FileSearchArgs = z.infer<typeof inputSchema>

interface SearchMatch {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly text: string
  readonly context_before: readonly string[]
  readonly context_after: readonly string[]
}

interface SearchParams {
  readonly query: string
  readonly contextLines: number
  readonly glob?: string
  /** Resolved search root — what the glob is matched against, per the tool contract. */
  readonly root: string
  readonly workspace: WorkspaceIdentity
  readonly signal: AbortSignal
}

type FileContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'binary' }
  | { readonly kind: 'skipped' }

export const fileSearchTool = createTool<FileSearchArgs>({
  name: 'file_search',
  description:
    'Search file contents by query string. Returns matching lines with file path, line number, ' +
    'and optional context lines. Case-insensitive. Searches recursively within the workspace.',
  inputSchema,
  capability: 'read',
  presentation: { label: 'Search files', emoji: '🔎', detailKeys: ['query'] },
  summarizeResult: summarizeFileSearch,
  async execute(args, ctx): Promise<string> {
    const resolver = PathPolicy.forRead(ctx.workspace)
    const realPath = await resolver.resolve(args.path)
    const params: SearchParams = {
      query: args.query,
      contextLines: args.context_lines ?? FILE_SEARCH_CONTEXT_LINES,
      ...(args.glob === undefined ? {} : { glob: args.glob }),
      root: realPath,
      workspace: ctx.workspace,
      signal: ctx.signal,
    }
    const limit = args.limit ?? FILE_SEARCH_MAX_RESULTS

    const { files, truncated } = await collectFiles(realPath, ctx.workspace, ctx.signal)
    const results: SearchMatch[] = []
    let binariesSkipped = 0

    for (const file of files) {
      if (ctx.signal.aborted || results.length >= limit) {
        break
      }

      const { matches, skippedBinary } = await searchFile(file, params, limit - results.length)
      results.push(...matches)

      if (skippedBinary) {
        binariesSkipped += 1
      }
    }

    return JSON.stringify({ results, binaries_skipped: binariesSkipped, truncated })
  },
})

async function collectFiles(
  realPath: string,
  workspace: WorkspaceIdentity,
  signal: AbortSignal
): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  const stat = await lstat(realPath).catch((err: unknown) => {
    if (isErrno(err, 'ENOENT')) {
      throw new ToolError('file_not_found', 'search path does not exist')
    }

    throw new ToolError('path_escape', 'search path is unavailable', err)
  })

  if (stat.isFile()) {
    return { files: [realPath], truncated: false }
  }

  if (!stat.isDirectory()) {
    throw new ToolError('invalid_input', 'search path is not a file or directory')
  }

  const { entries, truncated, depthCut } = await walkFiles({
    dirPath: realPath,
    workspace,
    signal,
  })
  const files = entries
    .filter((entry): entry is WalkFileEntry => entry.kind === 'file')
    .map((entry) => join(realPath, entry.relPath))

  return { files, truncated: truncated || depthCut }
}

async function searchFile(
  realPath: string,
  params: SearchParams,
  remaining: number
): Promise<{ readonly matches: readonly SearchMatch[]; readonly skippedBinary: boolean }> {
  // Two anchors on purpose: the glob filters against the search root, while a reported path stays
  // workspace-relative like every other tool's output.
  const relPath = relTo(params.workspace.path, realPath)

  if (
    PathPolicy.isSensitive(realPath) ||
    (params.glob && !isGlobMatch(params.glob, relTo(params.root, realPath)))
  ) {
    return { matches: [], skippedBinary: false }
  }

  if (hasBinaryExtension(realPath)) {
    return { matches: [], skippedBinary: true }
  }

  const content = await readSearchableFile(realPath, params)

  if (content.kind !== 'text') {
    return { matches: [], skippedBinary: content.kind === 'binary' }
  }

  return {
    matches: scanLines(content.text, relPath, { ...params, remaining }),
    skippedBinary: false,
  }
}

// Read through a descriptor, not the collected path: the walk enumerated these files earlier, and a
// parent swapped for a symlink since would otherwise put outside content in the results. A file
// that moved or vanished mid-scan is skipped; an escape is not.
async function readSearchableFile(realPath: string, params: SearchParams): Promise<FileContent> {
  let handle: FileHandle | undefined

  try {
    handle = await open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW)

    await PathPolicy.assertOpenedWithin(params.workspace, handle, realPath)

    const info = await handle.stat()

    if (!info.isFile() || info.size > FILE_SEARCH_MAX_BYTES) {
      return { kind: 'skipped' }
    }

    const content = await handle.readFile({ signal: params.signal })

    return isBinaryContent(content)
      ? { kind: 'binary' }
      : { kind: 'text', text: content.toString('utf8') }
  } catch (err: unknown) {
    if (err instanceof ToolError) {
      throw err
    }

    return { kind: 'skipped' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function scanLines(
  content: string,
  relPath: string,
  params: SearchParams & { readonly remaining: number }
): readonly SearchMatch[] {
  const lines = content.split('\n')
  const needle = params.query.toLowerCase()
  const matches: SearchMatch[] = []

  for (let i = 0; i < lines.length && matches.length < params.remaining; i += 1) {
    const line = lines[i] ?? ''
    const col = line.toLowerCase().indexOf(needle)

    if (col === -1) {
      continue
    }

    matches.push({
      file: relPath,
      line: i + 1,
      column: col + 1,
      text: line.trim(),
      context_before: lines.slice(Math.max(0, i - params.contextLines), i).map((l) => l.trim()),
      context_after: lines.slice(i + 1, i + 1 + params.contextLines).map((l) => l.trim()),
    })
  }

  return matches
}

function relTo(root: string, fullPath: string): string {
  const prefix = root.endsWith('/') ? root : `${root}/`

  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath
}

function summarizeFileSearch(content: string): DisplayText | undefined {
  const parsed = toSummaryJson(content)

  if (!(isPlainRecord(parsed) && Array.isArray(parsed.results))) {
    return undefined
  }

  const count = parsed.results.length

  return {
    key: count === 1 ? 'toolSummaries.fileSearchMatch' : 'toolSummaries.fileSearchMatches',
    params: { count },
  }
}
