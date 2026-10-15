import { open, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { Command, Group } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Trust } from '@/engine/api'
import { createCommand, createGroup } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { resolveSkillCatalog } from '@/cli/services'
import { fail, hint, style, success } from '@/cli/ui/colors'
import { expandHome, OperatorConfigError } from '@/core/config/resolve'
import { ConfigError, isAbortError, isErrno, ToolError } from '@/core/errors'
import { readCappedText } from '@/core/http-client'
import { createPrivateFileAtomic, replacePrivateFileAtomic } from '@/core/security/private-files'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import { sha256Hex } from '@/core/utils/hash'
import { sanitizeDisplayText } from '@/core/utils/text'
import {
  ensureSkillsDirectory,
  evaluateSkillContent,
  isAllowed,
  readLock,
  readSkillName,
  resolveLockPath,
  resolveSkillPlatform,
  writeLock,
} from '@/engine/api'
import { t } from '@/i18n'

const SKILL_FILE = 'SKILL.md'
const GH_PREFIX = 'gh:'
const HTTP_PREFIXES = ['https://', 'http://'] as const
// A URL parser collapses these (percent-encoded forms included), so a trust decision read off the
// raw segments would name a different owner than the one actually fetched.
const UNSAFE_GH_SEGMENT = /^(?:\.|%2e){1,2}$/i
const SKILL_FETCH_TIMEOUT_MS = 30_000
// Owners whose skills may carry a `caution` finding — never a `dangerous` one.
const TRUSTED_OWNERS: ReadonlySet<string> = new Set(['anthropics', 'openai', 'huggingface'])
const MAX_SKILL_BYTES = 1_048_576
const INSTALL_LOCK_SUFFIX = '.install'
// Past this the holder is a crashed process, not a slow install.
const INSTALL_LOCK_MAX_AGE_MS = 5 * 60_000

const INSTALL_LOCK_HOLDER = z.object({
  pid: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
})

type InstallLockHolder = z.infer<typeof INSTALL_LOCK_HOLDER>

interface Fetched {
  readonly text: string
  readonly source: string
  readonly trust: Trust
}

const skillCmdList: Command = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.skillListSummary' },
  run: listSkills,
})

const skillCmdInstall: Command = createCommand({
  name: 'install',
  summary: { key: 'cliHelp.skillInstallSummary' },
  spec: {
    positional: ['source'],
    flags: { force: { type: 'boolean', describe: { key: 'cliHelp.flagSkillForce' } } },
  },
  run: installSkill,
})

export const skillCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.skill,
  subcommands: [skillCmdList, skillCmdInstall],
})

async function listSkills(_args: ParsedArgs, app: CliApp): Promise<number> {
  const skills = await resolveSkillCatalog(app).list(
    {
      tools: new Set(app.resolve('tools').keys()),
      platform: resolveSkillPlatform(process.platform),
    },
    app.signal
  )

  if (skills.length === 0) {
    app.out(hint(t(app.config.locale.language, 'cli.skillNoSkillsFound')))

    return 0
  }

  for (const skill of skills) {
    app.out(`${style.heading(skill.name)}  ${hint(skill.description)}`)
  }

  return 0
}

async function installSkill(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const source = flagString(args, 'source')

  if (source === undefined) {
    return usage(app, t(locale, 'cli.skillInstallUsage'))
  }

  const force = flagBool(args, 'force')
  const fetched = await resolveSource(source, app.signal)
  const name = readSkillName(fetched.text)

  if (name === undefined) {
    return usage(app, t(locale, 'cli.skillNoFrontmatter', { source }))
  }

  resolveSkillCatalog(app).assertNotReserved(name)

  const { verdict, findings } = evaluateSkillContent(fetched.text)

  if (!isAllowed(fetched.trust, verdict, force)) {
    app.err(fail(t(locale, 'cli.skillRefused', { name, verdict, trust: String(fetched.trust) })))

    for (const finding of findings) {
      app.err(`  ${finding.severity}  ${finding.pattern}  ${sanitizeDisplayText(finding.excerpt)}`)
    }

    app.err(hint(t(locale, 'cli.skillForceHint')))

    return 1
  }

  return writeSkill(app, fetched, { name, verdict, force })
}

interface InstallTarget {
  readonly name: string
  readonly verdict: string
  readonly force: boolean
}

interface LockedSkillInput {
  readonly app: CliApp
  readonly fetched: Fetched
  readonly target: InstallTarget
  readonly skillsDir: string
  readonly lockPath: string
}

async function writeSkill(app: CliApp, fetched: Fetched, target: InstallTarget): Promise<number> {
  const skillsDir = await ensureSkillsDirectory(app.config.paths.dataDir)
  const lockPath = resolveLockPath(skillsDir)
  const installLockPath = `${lockPath}${INSTALL_LOCK_SUFFIX}`

  return withInstallLock(installLockPath, () =>
    writeLockedSkill({ app, fetched, target, skillsDir, lockPath })
  )
}

async function writeLockedSkill(input: LockedSkillInput): Promise<number> {
  const { app, fetched, target, skillsDir, lockPath } = input
  const { name, verdict, force } = target
  const lock = await readLock(lockPath)
  const path = join(skillsDir, name, SKILL_FILE)
  const previous = (await Bun.file(path).exists()) ? await Bun.file(path).text() : undefined

  // A second source claiming an installed name would silently replace the prompt the agent has been
  // following, so an overwrite is an explicit act.
  if (!force && (await Bun.file(path).exists())) {
    const previousSource = lock[name]?.source
    const from = typeof previousSource === 'string' ? ` (installed from ${previousSource})` : ''

    return usage(app, t(app.config.locale.language, 'cli.skillAlreadyExists', { name, from }))
  }

  const write = {
    path,
    content: fetched.text,
    validate: (content: string): void => {
      if (readSkillName(content) !== name) {
        throw new ConfigError(`installed skill name changed during write: ${name}`)
      }
    },
  }

  if (force) {
    await replacePrivateFileAtomic(write)
  } else {
    await createPrivateFileAtomic(write)
  }

  lock[name] = {
    source: fetched.source,
    installed_at: Date.now(),
    hash: await sha256Hex(fetched.text),
    trust: fetched.trust,
    verdict,
  }
  try {
    await writeLock(lockPath, lock)
  } catch (err: unknown) {
    await rollbackSkill(path, previous).catch(() => undefined)
    throw err
  }

  app.out(
    success(
      t(app.config.locale.language, 'cli.skillInstalled', {
        name,
        verdict,
        trust: String(fetched.trust),
        path,
      })
    )
  )

  return 0
}

async function rollbackSkill(path: string, previous: string | undefined): Promise<void> {
  if (previous !== undefined) {
    await replacePrivateFileAtomic({ path, content: previous })

    return
  }

  await unlink(path).catch(() => undefined)
}

async function withInstallLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const handle = await acquireInstallLock(path)

  try {
    return await run()
  } finally {
    await handle.close().catch(() => undefined)
    await unlink(path).catch(() => undefined)
  }
}

/** O_EXCL creation, with one reclaim of a lock whose holder is gone: without it a single SIGKILL
 *  refuses every future install until an operator finds and deletes a hidden file. */
async function acquireInstallLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  const held = await tryCreateInstallLock(path)

  if (held !== null) {
    return held
  }

  if (!(await releaseAbandonedInstallLock(path))) {
    throw new OperatorConfigError('another skill installation is already running', {
      key: 'errors.skillInstallBusy',
    })
  }

  const reclaimed = await tryCreateInstallLock(path)

  if (reclaimed === null) {
    throw new OperatorConfigError('another skill installation is already running', {
      key: 'errors.skillInstallBusy',
    })
  }

  return reclaimed
}

async function tryCreateInstallLock(
  path: string
): Promise<Awaited<ReturnType<typeof open>> | null> {
  let handle: Awaited<ReturnType<typeof open>>

  try {
    handle = await open(path, 'wx')
  } catch (err: unknown) {
    if (isErrno(err, 'EEXIST')) {
      return null
    }

    throw new ConfigError('cannot create the skill installation lock', err)
  }

  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8')

  return handle
}

/** True when the lock was abandoned and this call removed it. A live holder young enough to be a
 *  real concurrent install stays: reclaiming it lets two installs write one catalog. */
async function releaseAbandonedInstallLock(path: string): Promise<boolean> {
  const holder = await readInstallLockHolder(path)

  if (holder !== null) {
    return isProcessAlive(holder.pid) && !isExpiredInstallLock(holder.startedAt)
      ? false
      : await removeInstallLock(path)
  }

  // A crash between creating the lock and stamping it leaves no owner record, so mtime is the only
  // age there is.
  const info = await stat(path).catch(() => undefined)

  return info !== undefined && isExpiredInstallLock(info.mtimeMs)
    ? await removeInstallLock(path)
    : false
}

function removeInstallLock(path: string): Promise<boolean> {
  return unlink(path).then(
    () => true,
    () => false
  )
}

async function readInstallLockHolder(path: string): Promise<InstallLockHolder | null> {
  const raw = await readFile(path, 'utf8').catch(() => undefined)

  if (raw === undefined) {
    return null
  }

  const parsed = INSTALL_LOCK_HOLDER.safeParse(jsonOrNull(raw))

  return parsed.success ? parsed.data : null
}

function jsonOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // A truncated record is a holder that never finished writing; age decides.
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (err: unknown) {
    // EPERM means the pid exists and belongs to someone else — still alive.
    return !isErrno(err, 'ESRCH')
  }
}

/** A pid can be reused, so liveness alone would hold a crashed install's lock once it came round. */
function isExpiredInstallLock(startedAt: number): boolean {
  return Date.now() - startedAt > INSTALL_LOCK_MAX_AGE_MS
}

async function resolveSource(source: string, signal: AbortSignal): Promise<Fetched> {
  if (source.startsWith(GH_PREFIX)) {
    const path = source.slice(GH_PREFIX.length)
    const url = githubRawUrl(path)
    const owner = path.split('/')[0]
    const trust: Trust = owner !== undefined && TRUSTED_OWNERS.has(owner) ? 'trusted' : 'community'

    return { text: await fetchSkillText(url, signal), source, trust }
  }

  if (HTTP_PREFIXES.some((prefix) => source.startsWith(prefix))) {
    // http:// is refused inside guardedFetch's URL parse — one rejection path, not two.
    return { text: await fetchSkillText(source, signal), source, trust: 'community' }
  }

  const localPath = expandHome(source)
  const path = localPath.endsWith(SKILL_FILE) ? localPath : join(localPath, SKILL_FILE)
  const text = await readLocalSkillText(path, source)

  return { text, source, trust: 'local' }
}

async function readLocalSkillText(path: string, source: string): Promise<string> {
  const info = await stat(path).catch(() => undefined)

  if (info === undefined || !info.isFile()) {
    throw new OperatorConfigError(`no ${SKILL_FILE} at ${source}`, {
      key: 'errors.skillFileMissing',
      params: { source },
    })
  }

  if (info.size > MAX_SKILL_BYTES) {
    throw new OperatorConfigError(`skill source exceeds ${MAX_SKILL_BYTES} bytes: ${source}`, {
      key: 'errors.skillTooLarge',
      params: { source, limit: MAX_SKILL_BYTES },
    })
  }

  return Bun.file(path).text()
}

function skillFetchSignal(parent: AbortSignal): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(SKILL_FETCH_TIMEOUT_MS)])
}

// guardedFetch: https-only, SSRF re-checked on every redirect hop, outbound secret scan.
async function fetchSkillText(url: string, parentSignal: AbortSignal): Promise<string> {
  const signal = skillFetchSignal(parentSignal)
  let res: Response

  try {
    res = (await NetworkPolicy.guardedFetch(url, { signal })).response
  } catch (err: unknown) {
    if (isAbortError(err) && signal.aborted) {
      throw new OperatorConfigError(`skill fetch timed out or was aborted: ${url}`, {
        key: 'errors.skillFetchFailed',
        params: { source: url },
      })
    }

    throw new OperatorConfigError(
      `skill fetch failed: ${url}`,
      { key: 'errors.skillFetchFailed', params: { source: url } },
      { cause: err }
    )
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new OperatorConfigError(`skill fetch failed (${res.status}): ${url}`, {
      key: 'errors.skillFetchFailed',
      params: { source: url },
    })
  }

  // Stream-capped read: a hostile/oversized source cannot blow the heap before the trust scan
  // runs. The cap throws payload_too_large, surfaced as a ConfigError below for a friendly message.
  let text: string
  try {
    text = await readCappedText(res, MAX_SKILL_BYTES)
  } catch (err: unknown) {
    if (err instanceof ToolError && err.code === 'payload_too_large') {
      throw new OperatorConfigError(`skill source exceeds ${MAX_SKILL_BYTES} bytes: ${url}`, {
        key: 'errors.skillTooLarge',
        params: { source: url, limit: MAX_SKILL_BYTES },
      })
    }

    throw err
  }

  return text
}

function isUnsafeGhSegment(part: string): boolean {
  return part === '' || part.includes('\\') || UNSAFE_GH_SEGMENT.test(part)
}

function githubRawUrl(path: string): string {
  const segments = path.split('/')
  const [owner, repo, ...rest] = segments

  if (
    owner === undefined ||
    repo === undefined ||
    rest.length === 0 ||
    segments.some(isUnsafeGhSegment)
  ) {
    throw new OperatorConfigError('gh: source must be owner/repo/path-to-skill', {
      key: 'errors.skillGhSource',
    })
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${rest.join('/')}/${SKILL_FILE}`
}
