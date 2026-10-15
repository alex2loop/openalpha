import type { Dirent } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Plugin, PluginSourceModule, WorkflowSource } from '@/core/types/plugin'
import { isErrno } from '@/core/errors'
import { agentId, isPathId } from '@/core/ids'
import { readPluginManifest } from '@/plugins/policy/manifest'

const AGENTS_DIR = 'agents'
const AGENT_TOML = 'agent.toml'
const SKILLS_DIR = 'skills'
const WORKFLOWS_DIR = 'workflows'
const WORKFLOW_TOML = 'workflow.toml'
export const SOURCES_FILE = 'sources.ts'

type PluginPathStatus =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'valid'; readonly path: string; readonly isDirectory: boolean }

interface PluginTreeScan {
  readonly logger: Logger
  readonly plugin: string
  readonly root: string
}

export async function discoverInstalledPlugins(
  pluginsDir: string,
  logger: Logger
): Promise<readonly Plugin[]> {
  const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
  const root = await realpath(pluginsDir).catch(() => undefined)

  if (root === undefined) {
    return []
  }

  const plugins: Plugin[] = []

  for (const entry of entries) {
    const plugin = await discoverPlugin(entry, root, logger)

    if (plugin !== undefined) {
      plugins.push(plugin)
    }
  }

  return plugins
}

async function discoverPlugin(
  entry: Dirent,
  pluginsDir: string,
  logger: Logger
): Promise<Plugin | undefined> {
  if (!isPathId(entry.name)) {
    return undefined
  }

  const root = await findPluginRoot(entry.name, pluginsDir, logger)

  if (
    root === undefined ||
    !(await hasSafePluginTree(root, { logger, plugin: entry.name, root }))
  ) {
    return undefined
  }

  const result = await readPluginManifest(root)

  if (result.kind === 'invalid') {
    logger.warn('plugin.manifest_skipped', { plugin: entry.name, reason: result.reason })

    return undefined
  }

  const manifest = result.kind === 'valid' ? result.manifest : {}
  const id = manifest.id ?? entry.name
  const [agentIds, workflows, skillsDir, sourceModule] = await Promise.all([
    validAgentIds(join(root, AGENTS_DIR)),
    validWorkflowSources(join(root, WORKFLOWS_DIR)),
    existingDirectory(join(root, SKILLS_DIR)),
    validSourceModule(root, id),
  ])

  return {
    id,
    contributions: {
      agents: agentIds.map((agent) => ({
        id: agent,
        tomlPath: join(root, AGENTS_DIR, agent, AGENT_TOML),
      })),
      workflows,
      skillsDirs: skillsDir === undefined ? [] : [skillsDir],
      ...(manifest.commands === undefined ? {} : { declarativeSlashCommands: manifest.commands }),
      ...(manifest.channels === undefined ? {} : { declarativeChannels: manifest.channels }),
      ...(manifest.tools === undefined ? {} : { externalMcpTools: manifest.tools }),
      ...(sourceModule === undefined ? {} : { sourceModules: [sourceModule] }),
    },
  }
}

async function findPluginRoot(
  id: string,
  pluginsDir: string,
  logger: Logger
): Promise<string | undefined> {
  const path = join(pluginsDir, id)
  const status = await inspectPluginPath(path, pluginsDir)

  if (status.kind === 'missing') {
    return undefined
  }

  if (status.kind === 'invalid') {
    logger.warn('plugin.root_skipped', { plugin: id, reason: status.reason })

    return undefined
  }

  if (!status.isDirectory) {
    return undefined
  }

  return status.path
}

async function hasSafePluginTree(dir: string, scan: PluginTreeScan): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined)

  if (entries === undefined) {
    scan.logger.warn('plugin.root_skipped', { plugin: scan.plugin, reason: 'unreadable' })

    return false
  }

  for (const entry of entries) {
    const path = join(dir, entry.name)
    const status = await inspectPluginPath(path, scan.root)

    if (status.kind === 'missing') {
      continue
    }

    if (status.kind === 'invalid') {
      scan.logger.warn('plugin.path_skipped', {
        plugin: scan.plugin,
        path: relative(scan.root, path),
        reason: status.reason,
      })

      return false
    }

    if (status.isDirectory && !(await hasSafePluginTree(status.path, scan))) {
      return false
    }
  }

  return true
}

async function inspectPluginPath(path: string, root: string): Promise<PluginPathStatus> {
  const info = await lstat(path).catch((err: unknown) => {
    if (isErrno(err, 'ENOENT')) {
      return undefined
    }

    return null
  })

  if (info === undefined) {
    return { kind: 'missing' }
  }

  if (info === null) {
    return { kind: 'invalid', reason: 'unreadable' }
  }

  if (info.isSymbolicLink()) {
    return { kind: 'invalid', reason: 'symlink' }
  }

  const resolved = await realpath(path).catch(() => undefined)

  if (resolved === undefined) {
    return { kind: 'invalid', reason: 'unresolvable' }
  }

  if (!isPathInside(root, resolved)) {
    return { kind: 'invalid', reason: 'outside_plugin_root' }
  }

  return { kind: 'valid', path: resolved, isDirectory: info.isDirectory() }
}

/** Pure path math, which is enough only because the caller resolved the path through `realpath`
 *  first: this cannot see through a symlink itself. */
function isPathInside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path)

  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  )
}

async function existingDirectory(path: string): Promise<string | undefined> {
  const info = await lstat(path).catch(() => undefined)

  return info?.isDirectory() && !info.isSymbolicLink() ? path : undefined
}

async function validSourceModule(
  root: string,
  plugin: string
): Promise<PluginSourceModule | undefined> {
  const path = join(root, SOURCES_FILE)

  return (await Bun.file(path).exists()) ? { pluginId: plugin, modulePath: path } : undefined
}

async function validAgentIds(dir: string): Promise<readonly AgentId[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: AgentId[] = []

  for (const entry of entries) {
    if (!(entry.isDirectory() && isPathId(entry.name))) {
      continue
    }

    const agent = agentId(entry.name)

    if (await Bun.file(join(dir, agent, AGENT_TOML)).exists()) {
      found.push(agent)
    }
  }

  return found
}

async function validWorkflowSources(dir: string): Promise<readonly WorkflowSource[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: WorkflowSource[] = []

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      isPathId(entry.name) &&
      (await Bun.file(join(dir, entry.name, WORKFLOW_TOML)).exists())
    ) {
      found.push({ id: entry.name, definitionPath: join(dir, entry.name, WORKFLOW_TOML) })
    }
  }

  return found
}
