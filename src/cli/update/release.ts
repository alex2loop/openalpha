import { BRAND } from '@/core/brand'
import { BROWSER_HEADERS } from '@/core/http-client'

import { parseChangelog, type ReleaseNote } from './changelog'

const LATEST_RELEASE_URL = `${BRAND.repository}/releases/latest`
const RELEASE_TAG_RE = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/
const HTTP_ERROR_STATUS = 400
const HTTP_NOT_FOUND = 404
const CHECKSUMS_ASSET = 'SHA256SUMS'
const CHANGELOG_ASSET = 'CHANGELOG.md'
const WHITESPACE_RE = /\s+/
// A compiled binary runs its bundle from Bun's virtual filesystem (`/$bunfs/` on POSIX, a `~BUN`
// drive path on Windows); a source run has a real path.
const COMPILED_ENTRY_RE = /\/\$bunfs\/|[\\/]~BUN[\\/]/
// Release assets are named the way `bun run build:all` names them.
const RELEASE_PLATFORM_NAMES: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  win32: 'windows',
}
const WINDOWS_EXECUTABLE_SUFFIX = '.exe'

type LatestRead =
  | { readonly reached: true; readonly latest: string | null }
  | { readonly reached: false }

function findChecksum(sums: string, asset: string): string | null {
  for (const line of sums.split('\n')) {
    const [hash, name] = line.trim().split(WHITESPACE_RE)

    if (name === asset && hash !== undefined) {
      return hash
    }
  }

  return null
}

async function sha256OfFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')

  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk)
  }

  return hasher.digest('hex')
}

/** The body of an error status is never read, so it is closed rather than left to the collector. */
async function fetchAsset(url: string, signal: AbortSignal): Promise<Response | null> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, signal })

  if (res.ok) {
    return res
  }

  await res.body?.cancel()

  return null
}

function releaseAssetName(): string {
  const platform = RELEASE_PLATFORM_NAMES[process.platform] ?? process.platform
  const suffix = process.platform === 'win32' ? WINDOWS_EXECUTABLE_SUFFIX : ''

  return `${BRAND.name}-${platform}-${process.arch}${suffix}`
}

function buildReleaseTag(version: string): string {
  return `v${version}`
}

/** Reads GitHub's latest-release redirect, which costs nothing against the REST API's 60/hour
 *  limit. `latest` is null when nothing newer is published: no tag in the redirect (prereleases
 *  only) or no repository to read yet (404). Any other error status counts as unreached. Network
 *  errors throw. */
export async function readLatestRelease(signal: AbortSignal): Promise<LatestRead> {
  const res = await fetch(LATEST_RELEASE_URL, {
    method: 'HEAD',
    redirect: 'manual',
    headers: BROWSER_HEADERS,
    signal,
  })

  if (res.status === HTTP_NOT_FOUND) {
    return { reached: true, latest: null }
  }

  if (res.status >= HTTP_ERROR_STATUS) {
    return { reached: false }
  }

  const location = res.headers.get('location') ?? ''

  return { reached: true, latest: RELEASE_TAG_RE.exec(location)?.[1] ?? null }
}

export function buildReleaseUrl(version: string): string {
  return `${BRAND.repository}/releases/tag/${buildReleaseTag(version)}`
}

export function isCompiledBinary(): boolean {
  return COMPILED_ENTRY_RE.test(Bun.main)
}

/** Writes this platform's binary from the release to `dest` and reports whether it matches the
 *  release's SHA256SUMS; an error status is a mismatch too. Network errors throw. */
export async function downloadReleaseBinary(
  version: string,
  dest: string,
  signal: AbortSignal
): Promise<boolean> {
  const base = `${BRAND.repository}/releases/download/${buildReleaseTag(version)}`
  const asset = releaseAssetName()
  const sums = await fetchAsset(`${base}/${CHECKSUMS_ASSET}`, signal)
  const expected = sums === null ? null : findChecksum(await sums.text(), asset)

  if (expected === null) {
    return false
  }

  const binary = await fetchAsset(`${base}/${asset}`, signal)

  if (binary === null) {
    return false
  }

  await Bun.write(dest, binary)

  return (await sha256OfFile(dest)) === expected
}

/** The release's published CHANGELOG, parsed. Null when the release carries none (up to v1.0.5).
 *  Network errors throw. */
export async function readReleaseNotes(
  version: string,
  signal: AbortSignal
): Promise<readonly ReleaseNote[] | null> {
  const base = `${BRAND.repository}/releases/download/${buildReleaseTag(version)}`
  const res = await fetchAsset(`${base}/${CHANGELOG_ASSET}`, signal)

  return res === null ? null : parseChangelog(await res.text())
}
