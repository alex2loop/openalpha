import type { CliApp } from '@/cli/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { isInteractiveStderr } from '@/cli/env'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { hint, warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { MS_PER_DAY } from '@/core/utils/time'
import { t } from '@/i18n'

import type { UpdateState } from './state'
import { buildReleaseUrl } from './release'
import {
  isUpdateCheckEnabled,
  isUpdateStateFresh,
  newerVersionOf,
  readUpdateState,
  refreshUpdateState,
  writeUpdateState,
} from './state'

const NOTICE_INTERVAL_MS = MS_PER_DAY
const EXIT_SUCCESS = 0
const UPGRADE_COMMAND = `${BRAND.name} ${CLI_COMMAND_METADATA.upgrade.name}`
const FLAG_PREFIX = '-'
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

/** Starts the refresh alongside the command so the answer is usually in before it finishes; a
 *  command that ends first waits at most the check timeout, once a day. */
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

/** The notice when a newer release is known and none showed in the last day. The showing is
 *  recorded before it prints, so a data dir that cannot be written stays quiet instead of repeating it. */
export async function takeUpdateNotice(config: ResolvedConfig): Promise<readonly string[]> {
  try {
    if (!(await isUpdateCheckEnabled(config))) {
      return []
    }

    const now = Date.now()
    const state = await readUpdateState(config.paths.dataDir)
    const latest = newerVersionOf(state)

    if (latest === null || now - state.notifiedAt < NOTICE_INTERVAL_MS) {
      return []
    }

    await writeUpdateState(config.paths.dataDir, { ...state, notifiedAt: now })

    return formatUpdateNotice(config.locale.language, latest)
  } catch {
    // Unwritable data dir: no notice beats the same notice on every run.
    return []
  }
}

/** The line the morning brief ends with, read from the cache the daemon keeps fresh: a brief never
 *  waits on the release feed. */
export async function readUpdateLine(config: ResolvedConfig): Promise<string | null> {
  if (!(await isUpdateCheckEnabled(config))) {
    return null
  }

  const latest = newerVersionOf(await readUpdateState(config.paths.dataDir))

  return latest === null ? null : formatUpdateMessage(config.locale.language, latest)
}

export function formatUpdateStatus(locale: Locale, state: UpdateState): readonly string[] {
  const latest = newerVersionOf(state)

  if (latest !== null) {
    return formatUpdateNotice(locale, latest)
  }

  return [hint(t(locale, state.failed ? 'cli.updateUnchecked' : 'cli.updateUpToDate'))]
}

export function formatUpdateMessage(locale: Locale, latest: string): string {
  return t(locale, 'cli.updateAvailable', {
    brand: BRAND.display,
    latest: `v${latest}`,
    current: `v${BRAND.version}`,
    command: UPGRADE_COMMAND,
  })
}

function formatUpdateNotice(locale: Locale, latest: string): readonly string[] {
  return [
    warn(formatUpdateMessage(locale, latest)),
    hint(t(locale, 'cli.updateReleaseNotes', { url: buildReleaseUrl(latest) })),
  ]
}

/** No command (bare help) or a leading flag (`--help`) prints help, which stays clean. */
function isNoticeCommand(command: string | undefined): boolean {
  return command !== undefined && !command.startsWith(FLAG_PREFIX) && !QUIET_COMMANDS.has(command)
}

async function refreshWhenStale(config: ResolvedConfig): Promise<void> {
  try {
    const dataDir = config.paths.dataDir
    const now = Date.now()

    if (!(await isUpdateCheckEnabled(config))) {
      return
    }

    const state = await readUpdateState(dataDir)

    if (isUpdateStateFresh(state, now)) {
      return
    }

    // Marked failed first: an unwritable cache stops here instead of paying the timeout every run.
    await writeUpdateState(dataDir, { ...state, checkedAt: now, failed: true })
    await refreshUpdateState({ dataDir, now })
  } catch {
    // Started before the command and awaited after it: a rejection here would surface as an
    // unhandled one. There is no logger before boot, and a notice never fails a command.
  }
}
