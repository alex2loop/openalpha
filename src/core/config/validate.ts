import type { ResolvedConfig } from '@/core/config/resolve'
import {
  combineInvalidConfigErrors,
  InvalidConfigError,
  resolveConfig,
} from '@/core/config/resolve'
import { parseRawConfig } from '@/core/config/schema'
import { ConfigError } from '@/core/errors'

// The public way to validate a config tree held in memory (the API's config editor) without
// deep-importing core/config/schema, which stays internal. Validation = the same parse + resolve
// the boot path runs, then the caller's `assertResolved` for sections core does not own, so a tree
// that passes here boots.

interface ConfigIssue {
  readonly path: string
  readonly message: string
}

export type ConfigCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }

export function validateConfigTree(
  tree: unknown,
  assertResolved: (config: ResolvedConfig) => void
): ConfigCheck {
  try {
    assertResolved(resolveConfig(parseRawConfig(tree)))

    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, issues: [toIssue(err)] }
  }
}

function toIssue(err: unknown): ConfigIssue {
  if (err instanceof ConfigError) {
    return { path: formatPath(err.path), message: err.message }
  }

  return { path: '', message: String(err) }
}

function formatPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`
    }

    return acc === '' ? segment : `${acc}.${segment}`
  }, '')
}

/** A load refusal with what the sections core never reached refuse on their own folded in: core
 *  refuses its own sections before any module reads its own, so those are checked over defaults
 *  here and one run lists both. */
export function withExtensionRefusals(
  err: unknown,
  refusals: (config: ResolvedConfig) => readonly unknown[]
): readonly unknown[] {
  if (!(err instanceof InvalidConfigError) || err.unchecked === undefined) {
    return [err]
  }

  const extensions = extensionConfigErrors(err.unchecked, refusals)
  const invalid = extensions.filter((extension) => extension instanceof InvalidConfigError)
  const other = extensions.filter((extension) => !(extension instanceof InvalidConfigError))

  return [
    invalid.reduce((all, extension) => combineInvalidConfigErrors(all, extension), err),
    ...other,
  ]
}

function extensionConfigErrors(
  extensions: Readonly<Record<string, unknown>>,
  refusals: (config: ResolvedConfig) => readonly unknown[]
): readonly unknown[] {
  try {
    return refusals(resolveConfig(parseRawConfig(extensions)))
  } catch (err: unknown) {
    return [err]
  }
}
