import { builtinModules } from 'node:module'

import { BRAND } from '@/core/brand'

export interface BrowserBuildOptions {
  readonly entry: string
  readonly outdir: string
  readonly minify: boolean
  // Constants the bundler substitutes for a global the source names, each value already JSON.
  readonly define?: Readonly<Record<string, string>>
  // Leaves every node and bun builtin as an import so the metafile names who asked for it, even
  // where the polyfill is missing and the real build cannot get that far.
  readonly externalBuiltins?: boolean
}

export interface BrowserBuild {
  readonly success: boolean
  readonly logs: Bun.BuildOutput['logs']
  readonly outputs: readonly Bun.BuildArtifact[]
  readonly metafile: Bun.BuildMetafile | undefined
}

const BRAND_PLACEHOLDER = '{{brand}}'
const HEAD_END = '</head>'
const BUILTIN_SPECIFIERS: readonly string[] = ['bun', 'bun:*', 'node:*', ...builtinModules]

// Bun's browser polyfills stay on, so a builtin ships as the polyfill it would get, or fails the
// build where a polyfill lacks an export.
export async function buildBrowser(options: BrowserBuildOptions): Promise<BrowserBuild> {
  const result = await Bun.build({
    entrypoints: [options.entry],
    outdir: options.outdir,
    target: 'browser',
    format: 'esm',
    minify: options.minify,
    metafile: true,
    throw: false,
    ...(options.define === undefined ? {} : { define: { ...options.define } }),
    ...(options.externalBuiltins === true ? { external: [...BUILTIN_SPECIFIERS] } : {}),
  })

  return {
    success: result.success,
    logs: result.logs,
    outputs: result.outputs,
    metafile: result.metafile,
  }
}

/** `buildBrowser` for a static page's build: a failed bundle logs its messages and stops the build. */
export async function buildOrThrow(options: BrowserBuildOptions): Promise<BrowserBuild> {
  const build = await buildBrowser(options)

  if (!build.success) {
    for (const log of build.logs) {
      console.error(String(log))
    }

    throw new Error(`build failed: ${options.entry}`)
  }

  return build
}

/** A built page's html with the brand's display name where the source left its placeholder. */
export function stampBrand(html: string, file: string): string {
  if (!html.includes(BRAND_PLACEHOLDER)) {
    throw new Error(`${file} has no ${BRAND_PLACEHOLDER} to stamp`)
  }

  return html.replaceAll(BRAND_PLACEHOLDER, BRAND.display)
}

/** A built page's html with `tags` (one per line) just before its `</head>`. */
export function insertInHead(html: string, tags: readonly string[]): string {
  if (!html.includes(HEAD_END)) {
    throw new Error(`the page has no ${HEAD_END} to stamp`)
  }

  return html.replace(HEAD_END, () => `${tags.join('\n')}\n${HEAD_END}`)
}
