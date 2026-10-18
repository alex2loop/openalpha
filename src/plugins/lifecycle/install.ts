import { randomUUID } from 'node:crypto'
import { cp, lstat, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { BRAND } from '@/core/brand'
import { ToolError, ValidationError } from '@/core/errors'
import { isPathId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { createPrivateFileAtomic, ensurePrivateDirectory } from '@/core/security/private-files'
import { cloneRemoteSource } from '@/plugins/lifecycle/clone'
import { SOURCES_FILE } from '@/plugins/lifecycle/discover'
import { toPluginError } from '@/plugins/policy/errors'
import { type PluginManifest, parsePluginToml, readPluginManifest } from '@/plugins/policy/manifest'
import { isBundledId } from '@/plugins/policy/trust'

// Plugins are untrusted and their agents/skills/workflows become the agent's own instructions, so
// the fetch has to be authenticated: SSH has no trust-store validation and plaintext HTTP is
// rewritable by anyone on the path. HTTPS only.
const DISALLOWED_GIT_TRANSPORT_RE = /^(ext::|file:\/\/|ssh:\/\/|git@|http:\/\/)/i
const GIT_PREFIX_RE = /^git\+/
const GIT_SUFFIX_RE = /\.git$/
const REMOTE_SOURCE_RE = /^https:\/\//
const REMOTE_METADATA_RE = /[?#]/
// An authority is what separates a remote source from a local path: a Windows drive letter parses
// as a URL with scheme `c:`, and canonicalizing it as one would hand `resolve` a mangled path.
const URL_AUTHORITY_RE = /^[a-z][a-z0-9+.-]*:\/\//i
// `sources.ts` is code, not declarative content: it is inert until discovery finds it and
// `plugins.allow_code` admits it, and omitting it here left that documented contract unreachable.
const PLUGIN_CONTENT_PATHS = [
  'agents',
  'skills',
  'workflows',
  SOURCES_FILE,
] as const satisfies readonly string[]

interface InstallOptions {
  readonly source: string
  readonly pluginsDir: string
  readonly id?: string
  readonly force?: boolean
  readonly bundledIds?: ReadonlySet<string>
  readonly signal?: AbortSignal
}

interface InstallResult {
  readonly id: string
  readonly converted: number
  readonly skipped: readonly string[]
}

interface FetchedSource {
  readonly path: string
  readonly temporary: boolean
}

interface ReplacementPaths {
  readonly target: string
  readonly staging: string
  readonly backup: string
}

export async function installPlugin(options: InstallOptions): Promise<InstallResult> {
  const canonicalSource = canonicalPluginSource(options.source)
  const source = await fetchSource(canonicalSource, options.signal)

  try {
    return await installFetchedSource(options, source.path, canonicalSource)
  } catch (err: unknown) {
    throw toPluginError(err, 'plugin installation failed')
  } finally {
    if (source.temporary) {
      await rm(source.path, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function installFetchedSource(
  options: InstallOptions,
  source: string,
  canonicalSource: string
): Promise<InstallResult> {
  const manifest = await readInstallManifest(source)
  const id = resolveId(fallbackPluginId(source, canonicalSource), options.id, manifest)
  const target = assertPluginPath(id, options.pluginsDir)

  if (isBundledId(id, options.bundledIds ?? new Set())) {
    throw new ValidationError(`bundled plugin id: ${id}`, {
      key: 'errors.pluginBundledId',
      params: { id, brand: BRAND.display },
    })
  }
  if (!options.force && (await isPathPresent(target))) {
    throw new ValidationError(`plugin already installed: ${id}`, {
      key: 'errors.pluginAlreadyInstalled',
      params: { id, brand: BRAND.name },
    })
  }

  const staging = join(dirname(target), `.staging-${randomUUID()}`)
  const backup = join(dirname(target), `.backup-${randomUUID()}`)

  try {
    await copyPluginContent(source, staging, canonicalSource)
    await ensurePrivateDirectory(options.pluginsDir)
    await replacePlugin({ target, staging, backup })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }

  return { id, converted: 0, skipped: [] }
}

async function replacePlugin(paths: ReplacementPaths): Promise<void> {
  let backupCreated = false
  let preserveBackup = false

  try {
    if (await isPathPresent(paths.target)) {
      await rename(paths.target, paths.backup)
      backupCreated = true
    }

    await rename(paths.staging, paths.target)
  } catch (replacementErr: unknown) {
    if (backupCreated) {
      try {
        await rename(paths.backup, paths.target)
      } catch (recoveryErr: unknown) {
        preserveBackup = true
        throw replacementRecoveryError(replacementErr, recoveryErr, paths.backup)
      }
    }

    throw toPluginError(replacementErr, 'plugin replacement failed')
  } finally {
    if (!preserveBackup) {
      await rm(paths.backup, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function replacementRecoveryError(
  replacementErr: unknown,
  recoveryErr: unknown,
  backup: string
): ToolError {
  return new ToolError('unexpected', 'plugin replacement and recovery failed', {
    replacement: formatErrForLog(replacementErr),
    recovery: formatErrForLog(recoveryErr),
    backup,
  })
}

export async function uninstallPlugin(
  id: string,
  pluginsDir: string,
  bundledIds: ReadonlySet<string>
): Promise<void> {
  if (isBundledId(id, bundledIds)) {
    throw new ValidationError(`bundled plugin cannot be uninstalled: ${id}`, {
      key: 'errors.pluginBundledFixed',
      params: { id, brand: BRAND.display },
    })
  }

  const target = assertPluginPath(id, pluginsDir)

  try {
    await rm(target, { recursive: true, force: true })
  } catch (err: unknown) {
    throw toPluginError(err, `plugin uninstall failed: ${id}`)
  }
}

export async function updatePlugin(
  id: string,
  pluginsDir: string,
  bundledIds: ReadonlySet<string>
): Promise<void> {
  const target = assertPluginPath(id, pluginsDir)
  const source = await Bun.file(join(target, '.source'))
    .text()
    .catch(() => '')

  if (!source) {
    throw new ValidationError(`plugin has no source: ${id}`, {
      key: 'errors.pluginNoSource',
      params: { id, brand: BRAND.name },
    })
  }

  if (isBundledId(id, bundledIds)) {
    throw new ValidationError(`bundled plugin cannot be updated: ${id}`, {
      key: 'errors.pluginBundledFixed',
      params: { id, brand: BRAND.display },
    })
  }

  await installPlugin({ source, pluginsDir, id, force: true, bundledIds })
}

async function fetchSource(source: string, signal?: AbortSignal): Promise<FetchedSource> {
  const url = source.replace(GIT_PREFIX_RE, '')

  if (REMOTE_SOURCE_RE.test(url)) {
    return { path: await cloneRemoteSource(url, signal), temporary: true }
  }

  const path = isAbsolute(source) ? source : resolve(source)

  await assertLocalSource(path)

  return { path, temporary: false }
}

// A missing path copies nothing and still "installs": an empty dir named after the last segment.
async function assertLocalSource(path: string): Promise<void> {
  const stats = await stat(path).catch(() => undefined)

  if (stats === undefined) {
    throw new ValidationError(`plugin source not found: ${path}`, {
      key: 'errors.pluginSourceMissing',
      params: { path },
    })
  }

  if (!stats.isDirectory()) {
    throw new ValidationError(`plugin source is not a directory: ${path}`, {
      key: 'errors.pluginSourceNotFolder',
      params: { path },
    })
  }
}

// A remote source is cloned into a random temporary directory, so its name says nothing: the id a
// manifest-less plugin falls back to is the repository's, which keeps a reinstall on the same id.
function fallbackPluginId(dir: string, canonicalSource: string): string {
  const url = canonicalSource.replace(GIT_PREFIX_RE, '')

  if (!REMOTE_SOURCE_RE.test(url)) {
    return basename(dir)
  }

  const repository = new URL(url).pathname.split('/').findLast((segment) => segment !== '')

  return (repository ?? '').replace(GIT_SUFFIX_RE, '')
}

function resolveId(fallback: string, override?: string, manifest?: PluginManifest): string {
  const id = override ?? manifest?.id ?? fallback

  if (!isPathId(id)) {
    throw invalidIdError(id)
  }
  return id
}

async function readInstallManifest(dir: string): Promise<PluginManifest | undefined> {
  const result = await readPluginManifest(dir)

  if (result.kind === 'invalid') {
    throw new ToolError('invalid_input', `invalid plugin manifest: ${result.reason}`, result.cause)
  }

  return result.kind === 'valid' ? result.manifest : undefined
}

// Canonicalize a plugin source so the recorded `.source` never carries credentials or a meaningless
// query/hash fragment into the install metadata.
function canonicalPluginSource(source: string): string {
  const urlCandidate = source.replace(GIT_PREFIX_RE, '')

  if (DISALLOWED_GIT_TRANSPORT_RE.test(urlCandidate)) {
    throw new ValidationError(`disallowed git transport: ${source}`, {
      key: 'errors.pluginSourceTransport',
      params: { source },
    })
  }

  if (URL_AUTHORITY_RE.test(source) && URL.canParse(source)) {
    const url = new URL(source)

    if (url.username !== '' || url.password !== '') {
      throw new ValidationError('plugin source URL must not contain credentials', {
        key: 'errors.pluginSourceCredentials',
      })
    }
    if (url.search !== '' || url.hash !== '') {
      throw new ValidationError('plugin source URL must not contain a query or fragment', {
        key: 'errors.pluginSourceQuery',
      })
    }
    return url.toString()
  }

  if (REMOTE_SOURCE_RE.test(urlCandidate)) {
    if (REMOTE_METADATA_RE.test(source)) {
      throw new ValidationError('plugin source must not contain query or fragment data', {
        key: 'errors.pluginSourceQuery',
      })
    }

    return source
  }

  return resolve(source)
}

// `recordSource` is the canonical ref, not the temp clone (deleted in installPlugin's finally).
async function copyPluginContent(
  source: string,
  target: string,
  recordSource: string
): Promise<void> {
  await ensurePrivateDirectory(target)
  // dereference:false + assertNoSymlinks: a remote plugin must not smuggle host files via symlinks.
  for (const name of PLUGIN_CONTENT_PATHS) {
    if (await isPathPresent(join(source, name))) {
      await cp(join(source, name), join(target, name), { recursive: true, dereference: false })
    }
  }
  if (await isPathPresent(join(source, 'plugin.toml'))) {
    const manifestPath = join(source, 'plugin.toml')

    await createPrivateFileAtomic({
      path: join(target, 'plugin.toml'),
      content: await readFile(manifestPath, 'utf8'),
      validate: (content) => {
        parsePluginToml(content)
      },
    })
  }
  await assertNoSymlinks(target)
  const sourcePath = join(target, '.source')

  await createPrivateFileAtomic({ path: sourcePath, content: recordSource })
}

async function isPathPresent(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

// Validates id + containment: without this, `plugin uninstall ..` escapes pluginsDir.
function assertPluginPath(id: string, pluginsDir: string): string {
  if (!isPathId(id)) {
    throw invalidIdError(id)
  }

  const root = resolve(pluginsDir)
  const target = resolve(join(root, id))
  const rel = relative(root, target)

  // `rel === ''` is the root itself; `..` or `../…` escapes it; an absolute rel is a different volume.
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new ToolError('invalid_input', `plugin id escapes plugins directory: ${id}`)
  }

  return target
}

function invalidIdError(id: string): ValidationError {
  return new ValidationError(`invalid plugin id: ${id}`, {
    key: 'errors.pluginInvalidId',
    params: { id },
  })
}

// A plugin's installed content never legitimately needs symlinks.
async function assertNoSymlinks(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    const info = await lstat(entryPath)

    if (info.isSymbolicLink()) {
      throw new ToolError('invalid_input', 'plugin content contains a symlink')
    }

    if (info.isDirectory()) {
      await assertNoSymlinks(entryPath)
    }
  }
}
