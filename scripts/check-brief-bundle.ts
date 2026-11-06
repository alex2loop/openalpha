#!/usr/bin/env bun
// Phone app bundle gate. The app ships to a phone as a few kilobytes, so its bundle holds only the
// files below: nothing of the engine, the catalogs, persistence, the scene or the web app's state.
// Run alone it builds the page into a temporary folder; `build-brief` runs the same assertion on
// the build it ships. A type-only import is erased before the bundle, so it never counts.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { buildBriefPage } from './brief-page'

const ROOT = resolve(import.meta.dir, '..')
const CHECK_APP_URL = 'https://app.invalid/'
const BYTES_PER_KB = 1024
// The first measure (21.1 KB) rounded up to the next 5 KB; it only goes down.
const BRIEF_BUNDLE_MAX_GZIP_BYTES = 25 * BYTES_PER_KB
const MAX_IMPORTERS_NAMED = 3
const SHIPPED_FILE_RE = /\.(?:js|css)$/

const BRIEF_BUNDLE_INPUTS: readonly Bun.Glob[] = [
  'src/web/brief/**',
  'src/web/ui/reader/{brief-body,brief-model}.*',
  'src/web/ui/markdown/{inline,inline-view,note-list}.*',
  'src/web/ui/markdown/markdown.css',
  'src/web/ui/kit/{base,button,fold,section-heading,segmented,tokens}.*',
  'src/web/text/{glyphs,caution-text}.ts',
  'assets/brand/logo.svg',
  'node_modules/preact/**',
  'node_modules/@preact/signals*/**',
].map((pattern) => new Bun.Glob(pattern))

if (import.meta.main) {
  const outdir = await mkdtemp(join(tmpdir(), 'brief-bundle-'))

  try {
    const build = await buildBriefPage(outdir, CHECK_APP_URL)

    if (build.metafile === undefined) {
      throw new Error('brief bundle: the build wrote no metafile')
    }

    const gzipBytes = await gzipBytesOf(build.outputs)

    assertBriefBundle(build.metafile, gzipBytes)
    console.log(`check-brief-bundle: PASS (${(gzipBytes / BYTES_PER_KB).toFixed(1)} KB gzip)`)
  } catch (error) {
    console.error(`check-brief-bundle: FAIL\n${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

/** Throws a message naming every bundled file outside the allowlist with the files that import it,
 *  and the size when the shipped code outgrows its ceiling. */
export function assertBriefBundle(metafile: Bun.BuildMetafile, gzipBytes: number): void {
  const problems = [...strayInputs(metafile)]

  if (gzipBytes > BRIEF_BUNDLE_MAX_GZIP_BYTES) {
    problems.push(`${gzipBytes} bytes gzip is over the ${BRIEF_BUNDLE_MAX_GZIP_BYTES} byte ceiling`)
  }

  if (problems.length > 0) {
    throw new Error(`brief bundle:\n  ${problems.join('\n  ')}`)
  }
}

/** The gzip size of the script and style files a build wrote. */
export async function gzipBytesOf(outputs: readonly Bun.BuildArtifact[]): Promise<number> {
  const sizes = await Promise.all(
    outputs
      .filter((output) => SHIPPED_FILE_RE.test(output.path))
      .map(async (output) => Bun.gzipSync(new Uint8Array(await output.arrayBuffer())).length)
  )

  return sizes.reduce((total, size) => total + size, 0)
}

// The metafile names a file relative to the build's folder of origin, so every name is resolved
// from there before it is compared with the allowlist.
function strayInputs(metafile: Bun.BuildMetafile): string[] {
  const importers = new Map<string, string[]>()

  for (const [file, input] of Object.entries(metafile.inputs)) {
    for (const imported of input.imports) {
      const target = repoPath(imported.path)

      importers.set(target, [...(importers.get(target) ?? []), repoPath(file)])
    }
  }

  return Object.keys(metafile.inputs)
    .map(repoPath)
    .filter((file) => !BRIEF_BUNDLE_INPUTS.some((glob) => glob.match(file)))
    .map((file) => `${file} (imported by ${importersNote(importers.get(file) ?? [])})`)
}

function importersNote(importers: readonly string[]): string {
  const named = importers.slice(0, MAX_IMPORTERS_NAMED).join(', ')
  const more = importers.length - MAX_IMPORTERS_NAMED

  return more > 0 ? `${named} and ${more} more` : named
}

function repoPath(file: string): string {
  return relative(ROOT, resolve(process.cwd(), file))
}
