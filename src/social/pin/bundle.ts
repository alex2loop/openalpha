import { createHash } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { parse, stringify } from 'smol-toml'
import { z } from 'zod'

import type { NetworkPin } from '@/social/types'
import { BRAND } from '@/core/brand'
import { isErrno, ValidationError } from '@/core/errors'
import { HTTP_METHODS, SKILL_FILE_NAME_RE } from '@/social/constants'
import { writePrivateText } from '@/social/private-file'
import { SOCIAL_LABELS } from '@/social/skill/labels'
import { assertNetworkName } from '@/social/skill/parse'

const SOCIAL_DIRECTORY = 'social'
const POINTER_FILE = 'pin.json'
const PIN_FILE = 'network.toml'
const PIN_CHARS = 16
const HASH_PREFIX = 'sha256:'
const PIN_RE = /^[0-9a-f]{16}$/

const POINTER_SCHEMA = z.strictObject({
  current: z.string().regex(PIN_RE),
  previous: z.string().regex(PIN_RE).optional(),
  pending: z.string().regex(PIN_RE).optional(),
})
const PIN_SCHEMA = z.strictObject({
  name: z.string().min(1),
  source: z.url(),
  version: z.string().optional(),
  api_base: z.url(),
  approved_at: z.int(),
  files: z.record(z.string().regex(SKILL_FILE_NAME_RE), z.string().startsWith(HASH_PREFIX)),
  register: z
    .strictObject({
      method: z.enum(HTTP_METHODS),
      path: z.string().startsWith('/'),
      body: z.record(z.string(), z.string()),
      key_field: z.string().min(1),
      claim_fields: z.array(z.string().min(1)),
    })
    .optional(),
  endpoints: z.array(
    z.strictObject({
      method: z.enum(HTTP_METHODS),
      path: z.string().startsWith('/'),
      label: z.enum(SOCIAL_LABELS).optional(),
    })
  ),
})

type PinPointer = z.infer<typeof POINTER_SCHEMA>

type PinRecord = z.infer<typeof PIN_SCHEMA>

interface VerifiedRead {
  readonly pin: string
  readonly file: string
}

export interface SocialBundles {
  /** Writes one bundle folder and returns its pin. Moves no pointer. */
  write(pin: NetworkPin, files: ReadonlyMap<string, string>): Promise<string>
  readPointer(network: string): Promise<PinPointer | undefined>
  /** One atomic write: this is how a bundle becomes current, previous or pending. */
  writePointer(network: string, pointer: PinPointer): Promise<void>
  /** `mismatch` when `network.toml` is missing or no longer hashes to its own folder name. */
  readPin(network: string, pin: string): Promise<NetworkPin | 'mismatch'>
  /** A listed file's text, or `mismatch` when it is missing or no longer matches its hash. */
  readFile(network: string, pin: string, file: string): Promise<string | 'mismatch'>
  /** Removes every bundle folder the pointer no longer names. */
  prune(network: string): Promise<void>
  /** The network's whole folder, for undoing an install that failed half way. */
  folderOf(network: string): string
  hashOf(text: string): string
}

export function createSocialBundles(dataDir: string): SocialBundles {
  const root = join(dataDir, SOCIAL_DIRECTORY)
  const networkFolder = (network: string): string => networkFolderOf(root, network)
  const pinFolder = (network: string, pin: string): string =>
    join(networkFolder(network), assertPin(pin))

  return {
    hashOf,
    folderOf: networkFolder,
    write: (pin, files) => writeBundle(root, pin, files),
    readPointer: (network) => readPointer(join(networkFolder(network), POINTER_FILE), network),
    writePointer: (network, pointer) =>
      writePrivateText(join(networkFolder(network), POINTER_FILE), JSON.stringify(pointer)),
    readPin: (network, pin) => readPinFile(pinFolder(network, pin), { pin, network }),
    readFile: (network, pin, file) => readVerified(pinFolder(network, pin), network, { pin, file }),
    prune: (network) => pruneBundles(networkFolder(network), network),
  }
}

/** Every path is built from this name, so a `../` from the command line never leaves `root`. */
function networkFolderOf(root: string, network: string): string {
  assertNetworkName(network)

  return join(root, network)
}

function hashOf(text: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(text).digest('hex')}`
}

function pinIdOf(toml: string): string {
  return createHash('sha256').update(toml).digest('hex').slice(0, PIN_CHARS)
}

function assertPin(pin: string): string {
  if (!PIN_RE.test(pin)) {
    throw new ValidationError('not a pin')
  }

  return pin
}

async function writeBundle(
  root: string,
  pin: NetworkPin,
  files: ReadonlyMap<string, string>
): Promise<string> {
  const toml = toToml(pin)
  const id = pinIdOf(toml)
  const folder = join(root, pin.name, id)

  for (const [name, text] of files) {
    await writePrivateText(join(folder, name), text)
  }

  // Last, so a folder without its `network.toml` is never read as a bundle.
  await writePrivateText(join(folder, PIN_FILE), toml)

  return id
}

function toToml(pin: NetworkPin): string {
  return stringify({
    name: pin.name,
    source: pin.source,
    ...(pin.version === undefined ? {} : { version: pin.version }),
    api_base: pin.apiBase,
    approved_at: pin.approvedAt,
    files: pin.files,
    ...(pin.register === undefined
      ? {}
      : {
          register: {
            method: pin.register.method,
            path: pin.register.path,
            body: pin.register.body,
            key_field: pin.register.keyField,
            claim_fields: pin.register.claimFields,
          },
        }),
    endpoints: pin.endpoints.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      ...(endpoint.label === undefined ? {} : { label: endpoint.label }),
    })),
  })
}

function damaged(network: string, cause: unknown): ValidationError {
  return new ValidationError(
    'network pin is damaged',
    { key: 'social.pinDamaged', params: { brand: BRAND.name, network } },
    cause
  )
}

function toNetworkPin(text: string, network: string): NetworkPin {
  let record: PinRecord

  try {
    record = PIN_SCHEMA.parse(parse(text))
  } catch (err: unknown) {
    throw damaged(network, err)
  }

  return {
    name: record.name,
    source: record.source,
    ...(record.version === undefined ? {} : { version: record.version }),
    apiBase: record.api_base,
    approvedAt: record.approved_at,
    files: record.files,
    ...(record.register === undefined
      ? {}
      : {
          register: {
            method: record.register.method,
            path: record.register.path,
            body: record.register.body,
            keyField: record.register.key_field,
            claimFields: record.register.claim_fields,
          },
        }),
    endpoints: record.endpoints.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      ...(endpoint.label === undefined ? {} : { label: endpoint.label }),
    })),
  }
}

async function readPointer(path: string, network: string): Promise<PinPointer | undefined> {
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return undefined
    }

    throw err
  }

  try {
    return POINTER_SCHEMA.parse(JSON.parse(text))
  } catch (err: unknown) {
    // Nothing safe to fall back to: a pointer that cannot be read names no bundle.
    throw damaged(network, err)
  }
}

async function readPinFile(
  folder: string,
  who: { readonly pin: string; readonly network: string }
): Promise<NetworkPin | 'mismatch'> {
  const text = await readIfPresent(join(folder, PIN_FILE))

  if (text === undefined) {
    return 'mismatch'
  }

  return pinIdOf(text) === who.pin ? toNetworkPin(text, who.network) : 'mismatch'
}

/** A pinned file that is gone (a data dir moved without `social/`) reads like a damaged one. */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return undefined
    }

    throw err
  }
}

async function readVerified(
  folder: string,
  network: string,
  read: VerifiedRead
): Promise<string | 'mismatch'> {
  const pin = await readPinFile(folder, { pin: read.pin, network })

  if (pin === 'mismatch') {
    return pin
  }

  const expected = pin.files[read.file]

  if (expected === undefined) {
    throw new ValidationError(`${read.file} is not pinned for ${network}`, {
      key: 'social.fileNotPinned',
      params: { network, file: read.file },
    })
  }

  const text = await readIfPresent(join(folder, read.file))

  return text !== undefined && hashOf(text) === expected ? text : 'mismatch'
}

async function pruneBundles(folder: string, network: string): Promise<void> {
  const pointer = await readPointer(join(folder, POINTER_FILE), network)

  if (pointer === undefined) {
    return
  }

  const keep = new Set([pointer.current, pointer.previous, pointer.pending])

  for (const name of await readdir(folder)) {
    if (PIN_RE.test(name) && !keep.has(name)) {
      await rm(join(folder, name), { recursive: true, force: true })
    }
  }
}
