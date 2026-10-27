import { effect, type ReadonlySignal, signal } from '@preact/signals'

import type { CommandList } from '@/app/server/wire/system'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { cost } from '@/web/state/cost'
import { connection } from '@/web/state/session'
import { formatUsd } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

type SlashCommandInfo = CommandList['commands'][number]

const list = signal<readonly SlashCommandInfo[]>([])

/** The daemon's slash commands for the chat, read once per connection; empty until read. */
export const commands: ReadonlySignal<readonly SlashCommandInfo[]> = list

/** Reads `/v1/commands` each time the socket goes live; a failed read keeps the last list. */
export function startEstimates(): () => void {
  let controller: AbortController | undefined

  const stopSync = effect(() => {
    if (connection.value.status !== 'live') {
      return
    }

    controller?.abort()
    controller = new AbortController()
    // `loadCommands` catches its own failure, so it never rejects.
    loadCommands(controller.signal).catch(() => undefined)
  })

  return () => {
    stopSync()
    controller?.abort()
  }
}

/** What `name` (with its slash) usually costs; absent while the daemon has no estimate for it. */
export function estimateOf(name: string): SlashCommandInfo['estimate'] {
  return list.value.find((command) => command.name === name)?.estimate
}

/** Whether `name` (with its slash) is known to cost no AI: it never has, or never can. */
export function isNoAi(name: string): boolean {
  const estimate = estimateOf(name)

  return estimate !== undefined && isFree(estimate)
}

function isFree(estimate: NonNullable<SlashCommandInfo['estimate']>): boolean {
  return estimate.lowUsd === 0 && estimate.highUsd === 0
}

/** What `name` (with its slash) usually costs, and what is left of today's cap; absent while the
 *  daemon has no estimate for it. */
export function estimateText(name: string): string | undefined {
  const estimate = estimateOf(name)

  if (estimate === undefined) {
    return undefined
  }

  if (isFree(estimate)) {
    return tr('ui.office.common.noAi')
  }

  const range = tr('ui.office.command.estRange', {
    low: formatUsd(estimate.lowUsd),
    high: formatUsd(estimate.highUsd),
  })
  const left = leftTodayUsd()

  return left === undefined
    ? range
    : joinInline([range, tr('ui.office.command.estLeft', { left: formatUsd(left) })])
}

// A cap of 0 is no cap, so nothing is "left" of it.
function leftTodayUsd(): number | undefined {
  const view = cost.value

  if (view?.todayUsd === undefined || view.caps.dailyUsd <= 0) {
    return undefined
  }

  return Math.max(0, view.caps.dailyUsd - view.todayUsd)
}

async function loadCommands(abortSignal: AbortSignal): Promise<void> {
  try {
    list.value = (await getJson(ROUTES.commands, { signal: abortSignal })).commands
  } catch {
    // The completion lists only what it read; the box still sends whatever is typed.
  }
}
