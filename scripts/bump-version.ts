// Set the release version in the one place that is read (package.json) and the two that describe it
// (the CHANGELOG entry and its link), so a release cannot ship under three different numbers.
//
// Market strategy versions are a separate sequence with its own gate: see check-strategy-version.ts.
//
// Usage: bun run version:bump 1.1.0

import { BRAND } from '@/core/brand'
import { compareVersions } from '@/core/utils/version'

const PACKAGE = 'package.json'
const CHANGELOG = 'CHANGELOG.md'
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PACKAGE_VERSION_RE = /^(\s*"version":\s*)"[^"]+"/m
const UNRELEASED_HEADING = '## [Unreleased]'
const UNRELEASED_LINK_RE = /^\[Unreleased\]:.*$/m
const SECTION_RE = /^## \[/m
const LINK_RE = /^\[\d/m
const SCAFFOLD = '### Added\n\n-\n'
const DATE_LENGTH = 10
const EXIT_USAGE = 2
const EXIT_REFUSED = 1

/** Before the newest entry, so the file stays newest-first. */
function insertSection(text: string, heading: string): string {
  const at = SECTION_RE.exec(text)?.index

  return at === undefined
    ? `${text.trimEnd()}\n\n${heading}\n\n${SCAFFOLD}`
    : `${text.slice(0, at)}${heading}\n\n${SCAFFOLD}\n${text.slice(at)}`
}

function insertLink(text: string, link: string): string {
  const at = LINK_RE.exec(text)?.index

  return at === undefined
    ? `${text.trimEnd()}\n\n${link}\n`
    : `${text.slice(0, at)}${link}\n${text.slice(at)}`
}

const next = process.argv[2]

if (next === undefined || !VERSION_RE.test(next)) {
  console.error('usage: bun run version:bump <major.minor.patch>   e.g. 1.1.0')
  process.exit(EXIT_USAGE)
}

const packageText = await Bun.file(PACKAGE).text()
// A prerelease and its release compare equal, so a reissue of the same number is refused here.
if (compareVersions(next, BRAND.version) <= 0) {
  console.error(`refusing ${next}: not after the current ${BRAND.version}`)
  process.exit(EXIT_REFUSED)
}
if (!PACKAGE_VERSION_RE.test(packageText)) {
  console.error(`${PACKAGE}: no "version" line to rewrite`)
  process.exit(EXIT_REFUSED)
}

const heading = `## [${next}] - ${new Date().toISOString().slice(0, DATE_LENGTH)}`
const link = `[${next}]: ${BRAND.repository}/releases/tag/v${next}`
const changelog = await Bun.file(CHANGELOG).text()
const sectioned = changelog.includes(UNRELEASED_HEADING)
  ? changelog.replace(UNRELEASED_HEADING, heading)
  : insertSection(changelog, heading)
const linked = UNRELEASED_LINK_RE.test(sectioned)
  ? sectioned.replace(UNRELEASED_LINK_RE, link)
  : insertLink(sectioned, link)

await Bun.write(PACKAGE, packageText.replace(PACKAGE_VERSION_RE, `$1"${next}"`))
await Bun.write(CHANGELOG, linked)

console.log(`${PACKAGE}: ${BRAND.version} -> ${next}`)
console.log(`${CHANGELOG}: ${heading}`)
console.log(`\nwrite the entry, then:\n  git commit -am 'chore: release v${next}'`)
console.log(`  git tag -a v${next} -m 'v${next}' && git push origin main --follow-tags`)
