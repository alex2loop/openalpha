import { builtinModules } from 'node:module'

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
