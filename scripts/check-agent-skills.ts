#!/usr/bin/env bun
// Agent-skill wiring gate. `TRADING_SKILLS` is annotated with the whole `SkillName` record, so the
// compiler already proves that the catalogue and the union name the same skills, and every import
// path proves its folder exists. Three links it cannot see are left, and none fails loudly:
//
//   1. a record key paired with a binding imported from a different folder, which serves one
//      skill's text under another's name;
//   2. front matter whose `name` is not the folder, because the runtime catalogue keys on the
//      front matter while every playbook spells the folder;
//   3. a skill with no version, which folds two populations into one `calculationVersions` hash —
//      composition throws on it, so catching it here is the difference between CI and a boot.
import { Glob } from 'bun'
import { basename, dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SKILLS_GLOB = 'src/trading/skills/*/SKILL.md'
const CATALOG_FILE = 'src/trading/wiring/catalog/skills.ts'

const NAME_RE = /^name:\s*(\S+)/m
const VERSION_RE = /^\s+version:\s*"([^"]+)"/m
const IMPORT_RE = /import\s+(\w+)\s+from\s+'@\/trading\/skills\/([a-z0-9-]+)\/SKILL\.md'/g
const ENTRY_RE = /^ {2}(?:'([a-z0-9-]+)':\s*(\w+)|(\w+)),$/gm

interface Failure {
  readonly file: string
  readonly message: string
}

interface SkillFile {
  readonly name: string
  readonly version: string
}

const onDisk = await readOnDiskSkills()
const failures = [...(await catalogFailures(onDisk)), ...frontMatterFailures(onDisk)]

if (failures.length > 0) {
  for (const { file, message } of failures) {
    process.stderr.write(`${file}: ${message}\n`)
  }

  process.exit(1)
}

process.stdout.write(`check-agent-skills: PASS (${onDisk.size} skills)\n`)

/** Folder name to the front matter it declares, for every skill that ships in-tree. */
async function readOnDiskSkills(): Promise<ReadonlyMap<string, SkillFile>> {
  const found = new Map<string, SkillFile>()

  for await (const path of new Glob(SKILLS_GLOB).scan({ cwd: ROOT })) {
    const text = await Bun.file(resolve(ROOT, path)).text()

    found.set(basename(dirname(path)), {
      name: NAME_RE.exec(text)?.[1] ?? '',
      version: VERSION_RE.exec(text)?.[1] ?? '',
    })
  }

  return found
}

/** Each record key must name the folder its paired binding was imported from. */
async function catalogFailures(onDisk: ReadonlyMap<string, SkillFile>): Promise<readonly Failure[]> {
  const text = await Bun.file(resolve(ROOT, CATALOG_FILE)).text()
  const folderOf = new Map([...text.matchAll(IMPORT_RE)].map(([, ident, folder]) => [ident, folder]))
  const failures: Failure[] = []
  const keyed = new Set<string>()

  for (const [, quoted, paired, shorthand] of text.matchAll(ENTRY_RE)) {
    const ident = paired ?? shorthand
    const key = quoted ?? shorthand

    if (ident === undefined || key === undefined) {
      continue
    }

    keyed.add(key)
    const folder = folderOf.get(ident)

    if (folder !== key) {
      failures.push({
        file: CATALOG_FILE,
        message: `'${key}' is served by '${ident}', imported from '${folder ?? 'nowhere'}'`,
      })
    }
  }

  for (const folder of onDisk.keys()) {
    if (!keyed.has(folder)) {
      failures.push({ file: CATALOG_FILE, message: `'${folder}' has a SKILL.md but no entry` })
    }
  }

  return failures
}

function frontMatterFailures(onDisk: ReadonlyMap<string, SkillFile>): readonly Failure[] {
  const failures: Failure[] = []

  for (const [folder, skill] of onDisk) {
    const file = `src/trading/skills/${folder}/SKILL.md`

    if (skill.name !== folder) {
      failures.push({ file, message: `front-matter name '${skill.name}' is not its folder` })
    }

    if (skill.version === '') {
      failures.push({ file, message: 'declares no metadata.version' })
    }
  }

  return failures
}
