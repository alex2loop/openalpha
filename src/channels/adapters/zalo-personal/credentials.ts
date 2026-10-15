import { chmod, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { API, Credentials } from 'zca-js'
import { z } from 'zod'

import { PRIVATE_FILE_MODE, replacePrivateFileAtomic } from '@/core/security/private-files'

const CREDENTIALS_SUBDIR = 'credentials/zalo_personal'
const FILE_MODE_MASK = 0o777

const storedCredentialsSchema = z.object({
  imei: z.string().min(1),
  userAgent: z.string().min(1),
  language: z.string().optional(),
  cookie: z.array(z.looseObject({ key: z.string(), value: z.string() })),
})

export interface ProfileLocation {
  readonly dataDir: string
  readonly profile: string
}

export async function readZaloPersonalCredentials(
  location: ProfileLocation
): Promise<Credentials | undefined> {
  const path = resolveCredentialsPath(location)

  try {
    await tightenFileMode(path)

    const parsed = storedCredentialsSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))

    if (!parsed.success) {
      return undefined
    }

    const { imei, userAgent, language, cookie } = parsed.data
    return { imei, userAgent, cookie, ...(language === undefined ? {} : { language }) }
  } catch {
    // Missing, unreadable and malformed all ask the same of the operator: a fresh QR login.
    return undefined
  }
}

// Zalo rotates the session cookies as the account is used; storing them after each login keeps the
// next reconnect from presenting a set Zalo has already retired.
export async function writeZaloPersonalCredentials(
  location: ProfileLocation,
  api: API
): Promise<void> {
  const context = api.getContext()
  const jar = api.getCookie().toJSON()

  await replacePrivateFileAtomic({
    path: resolveCredentialsPath(location),
    content: JSON.stringify({
      imei: context.imei,
      userAgent: context.userAgent,
      language: context.language,
      cookie: jar?.cookies ?? [],
    }),
  })
}

export function resolveQrCodePath(location: ProfileLocation): string {
  return join(
    location.dataDir,
    CREDENTIALS_SUBDIR,
    `${encodeURIComponent(location.profile)}.qr.png`
  )
}

// A backup restore can silently widen a credentials file's permissions; re-tighten before trusting
// its plaintext contents rather than only checking the mode at write time.
async function tightenFileMode(path: string): Promise<void> {
  const mode = (await stat(path)).mode & FILE_MODE_MASK

  if (mode !== PRIVATE_FILE_MODE) {
    await chmod(path, PRIVATE_FILE_MODE)
  }
}

function resolveCredentialsPath(location: ProfileLocation): string {
  return join(location.dataDir, CREDENTIALS_SUBDIR, `${encodeURIComponent(location.profile)}.json`)
}
