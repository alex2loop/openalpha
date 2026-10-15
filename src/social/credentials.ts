import { chmod, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { z } from 'zod'

import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import { isErrno, ValidationError } from '@/core/errors'
import { isPathId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { PRIVATE_FILE_MODE } from '@/core/security/private-files'
import { writePrivateText } from '@/social/private-file'
import { assertNetworkName } from '@/social/skill/parse'

// Beside the other per-channel secrets; `db export` does not cover it, so the operator backs the
// folder up with the data dir.
const KEY_DIRECTORY = join('credentials', 'social')
const KEY_FILE_SCHEMA = z.strictObject({ apiKey: z.string().min(1) })

export interface SocialKeyFiles {
  /** `undefined` when there is no file, or when it is damaged (logged, never thrown). */
  read(network: string, agentId: AgentId): Promise<string | undefined>
  write(network: string, agentId: AgentId, apiKey: string): Promise<void>
  remove(network: string, agentId: AgentId): Promise<void>
  pathOf(network: string, agentId: AgentId): string
}

export function createSocialKeyFiles(dataDir: string, logger: Logger): SocialKeyFiles {
  const root = resolve(dataDir, KEY_DIRECTORY)
  const pathOf = (network: string, agentId: AgentId): string => keyPath(root, network, agentId)

  return {
    pathOf,
    read: (network, agentId) => readKey(pathOf(network, agentId), logger),
    write: (network, agentId, apiKey) =>
      writePrivateText(pathOf(network, agentId), JSON.stringify({ apiKey })),
    remove: async (network, agentId) => {
      await rm(pathOf(network, agentId), { force: true })
    },
  }
}

function keyPath(root: string, network: string, agentId: AgentId): string {
  assertNetworkName(network)

  if (!isPathId(agentId)) {
    throw new ValidationError(`not an agent id: ${agentId}`)
  }

  const path = resolve(root, network, `${agentId}.json`)

  // Both parts are path ids already; this states the invariant rather than trusting it.
  if (!path.startsWith(`${root}${sep}`)) {
    throw new ValidationError(`key path escapes ${root}`)
  }

  return path
}

async function readKey(path: string, logger: Logger): Promise<string | undefined> {
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return undefined
    }

    throw err
  }

  let apiKey: string

  try {
    apiKey = KEY_FILE_SCHEMA.parse(JSON.parse(text)).apiKey
  } catch {
    logger.warn('social.key_damaged', { path })

    return undefined
  }

  try {
    // Tightens a file a backup tool loosened; a good key stays good when this cannot.
    await chmod(path, PRIVATE_FILE_MODE)
  } catch (err: unknown) {
    logger.warn('social.key_chmod_failed', { path, err: formatErrForLog(err) })
  }

  return apiKey
}
