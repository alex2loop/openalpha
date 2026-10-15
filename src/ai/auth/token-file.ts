import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type { StoredTokens } from '@/ai/auth/types'
import { readRecord, readString } from '@/ai/auth/json'
import { ConfigError, isErrno } from '@/core/errors'
import { ensurePrivateDirectory, replacePrivateFileAtomic } from '@/core/security/private-files'

const AUTH_DIR_NAME = 'auth'
const TOKEN_FILE_SUFFIX = '.json'

export interface TokenFile {
  readonly path: string
  read(): Promise<StoredTokens | undefined>
  write(tokens: StoredTokens): Promise<void>
  clear(): Promise<void>
}

export function createTokenFile(dataDir: string, providerId: string): TokenFile {
  const directory = join(dataDir, AUTH_DIR_NAME)
  const path = join(directory, `${providerId}${TOKEN_FILE_SUFFIX}`)

  return Object.freeze({
    path,
    async read(): Promise<StoredTokens | undefined> {
      const raw = await readOptional(path)

      if (raw === undefined) {
        return undefined
      }

      try {
        return parseStoredTokens(raw, path)
      } catch (err: unknown) {
        if (err instanceof ConfigError) {
          throw err
        }

        throw new ConfigError(`token file is not valid JSON: ${path}`, err)
      }
    },
    async write(tokens: StoredTokens): Promise<void> {
      await ensurePrivateDirectory(directory)
      await replacePrivateFileAtomic({ path, content: JSON.stringify(tokens) })
    },
    async clear(): Promise<void> {
      try {
        await unlink(path)
      } catch (err: unknown) {
        if (!isErrno(err, 'ENOENT')) {
          throw new ConfigError(`cannot remove token file: ${path}`, err)
        }
      }
    },
  })
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return undefined
    }

    throw new ConfigError(`cannot read token file: ${path}`, err)
  }
}

function parseStoredTokens(raw: string, path: string): StoredTokens {
  const record = readRecord(JSON.parse(raw))
  const accessToken = readString(record?.accessToken)
  const refreshToken = readString(record?.refreshToken)
  const accountId = readString(record?.accountId)
  const expiresAt = record?.expiresAt
  const planType = readString(record?.planType)
  const email = readString(record?.email)

  if (
    accessToken === undefined ||
    refreshToken === undefined ||
    accountId === undefined ||
    typeof expiresAt !== 'number'
  ) {
    throw new ConfigError(`token file is missing required fields: ${path}`)
  }

  return {
    accessToken,
    refreshToken,
    accountId,
    expiresAt,
    ...(planType === undefined ? {} : { planType }),
    ...(email === undefined ? {} : { email }),
  }
}
