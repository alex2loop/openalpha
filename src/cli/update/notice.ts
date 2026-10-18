import type { CliApp } from '@/cli/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { isInteractiveStderr } from '@/cli/env'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { hint, success, warn } from '@/cli/ui/colors'
import { UPGRADE_CHAT_COMMAND } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { MS_PER_DAY } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'
import { t } from '@/i18n'

import type { UpdateChat, UpdateState } from './state'
import { buildReleaseUrl } from './release'
import {
  isUpdateCheckEnabled,
  isUpdateStateFresh,
  newerVersionOf,
  patchUpdateState,
  readUpdateState,
  refreshUpdateState,
  releaseNoteOf,
  releasesBehind,
} from './state'

const CLI_NOTICE_MS = MS_PER_DAY
const CHAT_NOTICE_MS = 7 * MS_PER_DAY
const CHAT_IMPORTANT_NOTICE_MS = MS_PER_DAY
const EXIT_SUCCESS = 0
export const UPGRADE_COMMAND = `${BRAND.name} ${CLI_COMMAND_METADATA.upgrade.name}`
const LINE_SEPARATOR = '\n'
const MESSAGE_SEPARATOR = ' '
const FLAG_PREFIX = '-'
const TONES = Object.freeze({ success, warn, hint })
// These print their own version status, speak a protocol on stdio, or are the daemon (which logs
// the notice instead, and would otherwise print it only when it shuts down).
const QUIET_COMMANDS: ReadonlySet<string> = new Set([
  CLI_COMMAND_METADATA.upgrade.name,
  CLI_COMMAND_METADATA.version.name,
  CLI_COMMAND_METADATA.help.name,
  CLI_COMMAND_METADATA.doctor.name,
  CLI_COMMAND_METADATA.mcp.name,
  CLI_COMMAND_METADATA.start.name,
  CLI_COMMAND_METADATA.restart.name,
])

interface UpdateNotice {
  /** Awaits the refresh; prints only after success so an error stays last on screen. Never rejects. */
  finish(exitCode: number | undefined): Promise<void>
}

const IDLE_NOTICE: UpdateNotice = Object.freeze({ finish: async () => undefined })

interface NoticeLine {
  readonly text: string
  readonly tone: keyof typeof TONES
}

interface NoticeCadence {
  readonly notifiedField: 'notifiedAt' | 'chatNotifiedAt'
  readonly announcedField: 'announcedVersion' | 'chatAnnouncedVersion'
  readonly everyMs: number
  readonly importantEveryMs: number
  readonly command: string
}

const CLI_CADENCE: NoticeCadence = Object.freeze({
  notifiedField: 'notifiedAt',
  announcedField: 'announcedVersion',
  everyMs: CLI_NOTICE_MS,
  importantEveryMs: CLI_NOTICE_MS,
  command: UPGRADE_COMMAND,
})

const CHAT_CADENCE: NoticeCadence = Object.freeze({
  notifiedField: 'chatNotifiedAt',
  announcedField: 'chatAnnouncedVersion',
  everyMs: CHAT_NOTICE_MS,
  importantEveryMs: CHAT_IMPORTANT_NOTICE_MS,
  command: UPGRADE_CHAT_COMMAND,
})

/** Starts the refresh alongside the command so the answer is usually in before it finishes; a
 *  command that ends first waits at most the refresh's timeouts, at most twice a day. */
export function startUpdateNotice(app: CliApp, command: string | undefined): UpdateNotice {
  if (!(isNoticeCommand(command) && isInteractiveStderr())) {
    return IDLE_NOTICE
  }

  const refreshed = refreshWhenStale(app.config)

  return {
    finish: async (exitCode) => {
      await refreshed

      if (exitCode !== EXIT_SUCCESS) {
        return
      }

      for (const line of await takeUpdateNotice(app.config)) {
        app.err(line)
      }
    },
  }
}

/** The notice when a newer release is known and none showed in the last day. */
export async function takeUpdateNotice(config: ResolvedConfig): Promise<readonly string[]> {
  return toTerminalLines(await takeNotice(config, CLI_CADENCE))
}

/** The private-chat reminder: weekly, daily while a release behind is important. */
export async function takeChatNotice(
  config: ResolvedConfig,
  chat: UpdateChat
): Promise<string | null> {
  if (!isUpdateCheckEnabled(config)) {
    return null
  }

  await rememberOperatorChat(config.paths.dataDir, chat).catch(() => {
    // Unwritable data dir: the chat remembered before, or none, is where an update reports.
  })

  const lines = await takeNotice(config, CHAT_CADENCE)

  return lines.length === 0 ? null : toChatText(lines)
}

/** The line the morning brief ends with, read from the cache the daemon keeps fresh: a brief never
 *  waits on the release feed. */
export async function readUpdateLine(config: ResolvedConfig): Promise<string | null> {
  if (!isUpdateCheckEnabled(config)) {
    return null
  }

  const state = await readUpdateState(config.paths.dataDir)
  const lines = formatUpdateNotice(config.locale.language, state, UPGRADE_CHAT_COMMAND)

  return lines.length === 0 ? null : toChatText(lines)
}

export function formatUpdateStatus(locale: Locale, state: UpdateState): readonly string[] {
  if (newerVersionOf(state) !== null) {
    return toTerminalLines(formatUpdateNotice(locale, state, UPGRADE_COMMAND))
  }

  return [hint(t(locale, state.failed ? 'cli.updateUnchecked' : 'cli.updateUpToDate'))]
}

export function formatUpdateMessage(locale: Locale, latest: string): string {
  return [
    formatAvailable(locale, latest),
    t(locale, 'cli.updateAction', { command: UPGRADE_COMMAND }),
  ].join(MESSAGE_SEPARATOR)
}

/** Empty when nothing newer is known. The summary line appears only in the reader's language, so a
 *  Vietnamese notice never carries an English sentence. */
export function formatUpdateNotice(
  locale: Locale,
  state: UpdateState,
  command: string
): readonly NoticeLine[] {
  const latest = newerVersionOf(state)

  if (latest === null) {
    return []
  }

  const behind = releasesBehind(state)
  const lines: NoticeLine[] = [{ text: formatAvailable(locale, latest), tone: 'warn' }]

  if (behind.length > 1) {
    lines.push({ text: t(locale, 'cli.updateBehind', { count: behind.length }), tone: 'hint' })
  }

  if (behind.some((note) => note.important)) {
    lines.push({ text: t(locale, 'cli.updateImportant'), tone: 'warn' })
  }

  lines.push(...summaryLines(locale, behind[0]?.summary[locale]))
  lines.push(
    { text: t(locale, 'cli.updateAction', { command }), tone: 'hint' },
    { text: t(locale, 'cli.updateReleaseNotes', { url: buildReleaseUrl(latest) }), tone: 'hint' }
  )

  return lines
}

/** `upgraded`: said once after an update lands, rather than in answer to a version check. */
export function formatInstalledNotice(
  locale: Locale,
  state: UpdateState,
  options: { readonly upgraded: boolean }
): readonly NoticeLine[] {
  return [
    {
      text: t(locale, options.upgraded ? 'cli.updateCompleted' : 'cli.updateInstalled', {
        brand: BRAND.display,
        version: `v${BRAND.version}`,
      }),
      tone: 'success',
    },
    ...summaryLines(locale, releaseNoteOf(state, BRAND.version)?.summary[locale]),
  ]
}

function formatAvailable(locale: Locale, latest: string): string {
  return t(locale, 'cli.updateAvailable', {
    brand: BRAND.display,
    latest: `v${latest}`,
    current: `v${BRAND.version}`,
  })
}

function toTerminalLines(lines: readonly NoticeLine[]): readonly string[] {
  return lines.map((line) => TONES[line.tone](line.text))
}

/** A chat never gets colour codes or the terminal's warning icon. */
export function toChatText(lines: readonly NoticeLine[]): string {
  return lines.map((line) => line.text).join(LINE_SEPARATOR)
}

function summaryLines(locale: Locale, summary: string | undefined): readonly NoticeLine[] {
  if (summary === undefined || summary === '') {
    return []
  }

  return [{ text: t(locale, 'cli.updateSummary', { summary }), tone: 'hint' }]
}

/** Each showing is recorded before it prints, so a data dir that cannot be written stays quiet
 *  instead of repeating itself. The first run only records the running version, so a fresh install
 *  announces nothing. */
async function takeNotice(
  config: ResolvedConfig,
  cadence: NoticeCadence
): Promise<readonly NoticeLine[]> {
  try {
    if (!isUpdateCheckEnabled(config)) {
      return []
    }

    const { dataDir } = config.paths
    const locale = config.locale.language
    const now = Date.now()
    const state = await readUpdateState(dataDir)
    const announced = state[cadence.announcedField]
    const seen: Partial<UpdateState> = { [cadence.announcedField]: BRAND.version }

    if (announced !== null && compareVersions(announced, BRAND.version) < 0) {
      await patchUpdateState(dataDir, seen)

      return formatInstalledNotice(locale, state, { upgraded: true })
    }

    if (announced === null) {
      await patchUpdateState(dataDir, seen)
    }

    if (
      newerVersionOf(state) === null ||
      now - state[cadence.notifiedField] < intervalOf(state, cadence)
    ) {
      return []
    }

    await patchUpdateState(dataDir, { ...seen, [cadence.notifiedField]: now })

    return formatUpdateNotice(locale, state, cadence.command)
  } catch {
    // Unwritable data dir: no notice beats the same notice on every run.
    return []
  }
}

/** Written only when it changes, so an ordinary message costs a read. */
async function rememberOperatorChat(dataDir: string, chat: UpdateChat): Promise<void> {
  const known = (await readUpdateState(dataDir)).operatorChat

  if (known?.channel === chat.channel && known.chatId === chat.chatId) {
    return
  }

  await patchUpdateState(dataDir, { operatorChat: chat })
}

function intervalOf(state: UpdateState, cadence: NoticeCadence): number {
  return releasesBehind(state).some((note) => note.important)
    ? cadence.importantEveryMs
    : cadence.everyMs
}

/** No command (bare help) or a leading flag (`--help`) prints help, which stays clean. */
function isNoticeCommand(command: string | undefined): boolean {
  return command !== undefined && !command.startsWith(FLAG_PREFIX) && !QUIET_COMMANDS.has(command)
}

async function refreshWhenStale(config: ResolvedConfig): Promise<void> {
  try {
    const dataDir = config.paths.dataDir
    const now = Date.now()

    if (!isUpdateCheckEnabled(config)) {
      return
    }

    const state = await readUpdateState(dataDir)

    if (isUpdateStateFresh(state, now)) {
      return
    }

    // Written back unchanged first: an unwritable cache stops here instead of paying the timeout
    // every run. Marking it failed here would answer a `/upgrade` asked during the fetch.
    await patchUpdateState(dataDir, {})
    await refreshUpdateState({ dataDir, now })
  } catch {
    // Started before the command and awaited after it: a rejection here would surface as an
    // unhandled one. There is no logger before boot, and a notice never fails a command.
  }
}
