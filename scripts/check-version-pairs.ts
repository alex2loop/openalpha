#!/usr/bin/env bun
// A number written in two files drifts silently. These pairs have no other owner:
//
//   - the Biome version. biome.json's $schema pins the version an editor validates against;
//     package.json pins the one that actually runs `biome check`.
//   - the pinned Bun build. Every release binary has one exact Bun built in, and CI runs the
//     gates on one exact Bun. Shipping users a build the gates never ran on defeats both pins,
//     so they are the same number in every job of both workflows.
//   - the gate counts CONTRIBUTING quotes, in both languages. They are what a contributor checks
//     their own run against, and they went stale within one release of being written. Both copies
//     are read, because a translated number drifts exactly as easily as the original and a number
//     nobody checks is a number nobody owns.
//
// The product version is not here: bump-version.ts owns package.json and the CHANGELOG, and
// market strategy versions are their own sequence under check-strategy-version.ts.
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')

interface Pair {
  readonly what: string
  readonly left: string
  readonly leftWhere: string
  readonly right: string
  readonly rightWhere: string
}

const read = async (rel: string): Promise<string> => await Bun.file(resolve(ROOT, rel)).text()

const capture = (text: string, re: RegExp, where: string): string => {
  const found = re.exec(text)?.[1]

  if (found === undefined) {
    console.log(`FAIL: ${where} - nothing matched ${re}. The gate is stale, not the version.`)
    process.exit(1)
  }

  return found
}

const BUN_PIN_RE = /bun-version:\s*([\d.]+)/g

const pinnedBun = (text: string, where: string): string => {
  const pins = [...new Set([...text.matchAll(BUN_PIN_RE)].map((match) => match[1] ?? ''))]

  if (pins.length !== 1 || pins[0] === undefined) {
    console.log(`FAIL: ${where} pins Bun as [${pins.join(', ')}]; every job must pin one version.`)
    process.exit(1)
  }

  return pins[0]
}

// A gate is one `&&` step that runs a scripts/check-*.ts, so a script sitting in the folder
// unwired is not counted and a script wired twice is counted twice - which is what a
// contributor's terminal shows them.
const countGates = (script: string, where: string): string => {
  const steps = script.split(' && ').filter((step) => step.includes('scripts/check-'))

  if (steps.length === 0) {
    console.log(`FAIL: ${where} - no gate steps found. The gate is stale, not the count.`)
    process.exit(1)
  }

  return String(steps.length)
}

const packageText = await read('package.json')
const biomeText = await read('biome.json')
const releaseWorkflowText = await read('.github/workflows/release.yml')
const checkWorkflowText = await read('.github/workflows/check.yml')
const contributingEnText = await read('CONTRIBUTING.en.md')
const contributingViText = await read('CONTRIBUTING.md')
const readmeViText = await read('README.md')
const readmeEnText = await read('README.en.md')

const scripts = (JSON.parse(packageText) as { scripts: Record<string, string> }).scripts
const contractGates = countGates(scripts.check, 'package.json scripts.check')
const architectureGates = countGates(scripts['lint:arch'], 'package.json scripts.lint:arch')
// The READMEs quote one total rather than the two commands. It sat at 28 through three changes to
// the real count, which is why it is read here and not trusted to a reviewer's eye.
const totalGates = String(Number(contractGates) + Number(architectureGates))

const pairs: readonly Pair[] = [
  {
    what: 'Biome version',
    left: capture(packageText, /"@biomejs\/biome":\s*"([\d.]+)"/, 'package.json @biomejs/biome'),
    leftWhere: 'package.json @biomejs/biome',
    right: capture(biomeText, /biomejs\.dev\/schemas\/([\d.]+)\//, 'biome.json $schema'),
    rightWhere: 'biome.json $schema',
  },
  {
    what: 'pinned Bun build',
    left: pinnedBun(releaseWorkflowText, 'release.yml'),
    leftWhere: '.github/workflows/release.yml bun-version',
    right: pinnedBun(checkWorkflowText, 'check.yml'),
    rightWhere: '.github/workflows/check.yml bun-version',
  },
  {
    what: 'contract gate count (English)',
    left: contractGates,
    leftWhere: 'package.json scripts.check',
    right: capture(contributingEnText, /(\d+) contract gates/, 'CONTRIBUTING.en.md contract gates'),
    rightWhere: 'CONTRIBUTING.en.md',
  },
  {
    what: 'architecture gate count (English)',
    left: architectureGates,
    leftWhere: 'package.json scripts.lint:arch',
    right: capture(
      contributingEnText,
      /(\d+) architecture gates/,
      'CONTRIBUTING.en.md architecture gates'
    ),
    rightWhere: 'CONTRIBUTING.en.md',
  },
  {
    what: 'contract gate count (Vietnamese)',
    left: contractGates,
    leftWhere: 'package.json scripts.check',
    right: capture(contributingViText, /(\d+) cổng hợp đồng/, 'CONTRIBUTING.md cong hop dong'),
    rightWhere: 'CONTRIBUTING.md',
  },
  {
    what: 'architecture gate count (Vietnamese)',
    left: architectureGates,
    leftWhere: 'package.json scripts.lint:arch',
    right: capture(contributingViText, /(\d+) cổng kiến trúc/, 'CONTRIBUTING.md cong kien truc'),
    rightWhere: 'CONTRIBUTING.md',
  },
  {
    what: 'total gate count (English README)',
    left: totalGates,
    leftWhere: 'package.json, both gate commands',
    right: capture(readmeEnText, /(\d+) gates break the build/, 'README.en.md gate total'),
    rightWhere: 'README.en.md',
  },
  {
    what: 'total gate count (Vietnamese README)',
    left: totalGates,
    leftWhere: 'package.json, both gate commands',
    right: capture(readmeViText, /(\d+) cổng chặn/, 'README.md gate total'),
    rightWhere: 'README.md',
  },
]

const drifted = pairs.filter((p) => p.left !== p.right)

if (drifted.length > 0) {
  console.log(`FAIL: ${drifted.length} version(s) written in two places and disagreeing.`)
  console.log()

  for (const p of drifted) {
    console.log(`  ${p.what}`)
    console.log(`    ${p.leftWhere}: ${p.left}`)
    console.log(`    ${p.rightWhere}: ${p.right}`)
  }

  console.log()
  console.log('Change both together.')
  process.exit(1)
}

console.log(`check-version-pairs: PASS (${pairs.length} pair(s) agree)`)
