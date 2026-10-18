const RELEASE_RE = /^(\d+\.\d+\.\d+)/

/** Negative, zero or positive as `left` orders before, with, or after `right`. A prerelease suffix
 *  does not order: `1.1.0-rc.1` and `1.1.0` compare equal. */
export function compareVersions(left: string, right: string): number {
  const ordered = releaseOf(left)
  const against = releaseOf(right)

  for (const [index, part] of ordered.entries()) {
    const other = against[index] ?? 0

    if (part !== other) {
      return part - other
    }
  }

  return 0
}

/** True when `candidate` is newer than `current` within the same major and minor: a 1.0.x fix, never a
 *  1.1.0 feature release. */
export function isPatchRelease(candidate: string, current: string): boolean {
  const [major, minor] = releaseOf(candidate)
  const [currentMajor, currentMinor] = releaseOf(current)

  return major === currentMajor && minor === currentMinor && compareVersions(candidate, current) > 0
}

function releaseOf(version: string): readonly number[] {
  return (RELEASE_RE.exec(version)?.[1] ?? version).split('.').map(Number)
}
