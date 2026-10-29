import { type Signal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { ThemesResponse, ThemeTransitionWire } from '@/app/server/wire/themes'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { onCommandFinished } from '@/web/state/events'
import { homeRegion } from '@/web/state/market'
import { isModelReady } from '@/web/state/session'
import { toErrorText, tr } from '@/web/text/tr'
import { RunButton } from '@/web/ui/command/run-button'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { BulbIcon } from '@/web/ui/kit/icons'
import { Outline } from '@/web/ui/market/outline'
import { BlockFrame } from '@/web/ui/today/block-frame'

// A bare `/themes` is the run that re-reads every tracked theme and looks for new ones; `run <id>`
// re-reads one.
const THEMES_COMMAND = 'themes'
const RUN_TEXT = `/${THEMES_COMMAND}`
const RUN_ONE_TEXT = `${RUN_TEXT} run`
const PROPOSED = 'proposed'
// Met a condition that ends it: it waits to be retired, and a run refuses it.
const INVALIDATED = 'invalidated'
// Themes read the Vietnam market only.
const THEMES_REGION = 'vn'

type ThemeWire = ThemesResponse['themes'][number]

/** What the last move on a theme answered, in the daemon's words: a done move reads above the
 *  lists, where a theme it closed is no longer listed; a refusal reads under its theme. */
interface MoveAnswer {
  readonly themeId: string
  readonly text: string
  readonly isRefused: boolean
}

interface MoveContext {
  readonly answer: Signal<MoveAnswer | undefined>
  readonly reread: () => void
}

/** Chủ đề: proposals to decide, themes followed, and `/themes show` for them. The page moves a
 *  theme; Chạy lại runs `/themes` at once, or `/themes run <id>` on a followed theme. */
export function Themes() {
  const reading = useBlock(ROUTES.themes)
  const answer = useSignal<MoveAnswer | undefined>(undefined)

  useEffect(() => onCommandFinished(THEMES_COMMAND, reading.retry), [])

  return (
    <BlockFrame
      title={tr('ui.office.market.tab.themes')}
      colour="yellow"
      icon={<BulbIcon />}
      reading={reading}
      action={<RunAgain />}
    >
      {(data) => (
        <>
          <VnOnlyNote />
          {!isModelReady.value && (
            <p class="strip is-caution">{tr('ui.office.themes.needsModel')}</p>
          )}
          {answer.value?.isRefused === false && <p class="meta">{answer.value.text}</p>}
          {data.themes.length === 0 ? (
            <p class="empty-note">{tr('ui.office.themes.none')}</p>
          ) : (
            <ThemeLists data={data} context={{ answer, reread: reading.retry }} />
          )}
        </>
      )}
    </BlockFrame>
  )
}

// Said only where the operator's home is elsewhere: a Vietnam home reads every theme here.
function VnOnlyNote() {
  const home = homeRegion()

  return home === undefined || home === THEMES_REGION ? null : (
    <p class="strip is-caution">{tr('ui.office.themes.vnOnly')}</p>
  )
}

function RunAgain() {
  return (
    <RunButton
      command={RUN_TEXT}
      label={tr('ui.office.themes.rerun')}
      busyLabel={tr('ui.office.themes.running')}
      kind="ai"
      size="small"
      disabled={!isModelReady.value}
      isQuiet
    />
  )
}

function ThemeLists({
  data,
  context,
}: {
  readonly data: ThemesResponse
  readonly context: MoveContext
}) {
  const proposed = data.themes.filter((theme) => theme.status === PROPOSED)
  const tracked = data.themes.filter((theme) => theme.status !== PROPOSED)

  return (
    <>
      <ThemeGroup title={tr('ui.office.themes.proposed')} themes={proposed} context={context} />
      <ThemeGroup title={tr('ui.office.themes.tracked')} themes={tracked} context={context} />
      <Outline lines={data.text} />
    </>
  )
}

interface ThemeGroupProps {
  readonly title: string
  readonly themes: readonly ThemeWire[]
  readonly context: MoveContext
}

function ThemeGroup({ title, themes, context }: ThemeGroupProps) {
  if (themes.length === 0) {
    return null
  }

  return (
    <>
      <h3 class="sub-head">{title}</h3>
      <div class="row-list">
        {themes.map((theme) => (
          <ThemeRow key={theme.id} theme={theme} context={context} />
        ))}
      </div>
    </>
  )
}

interface ThemeRowProps {
  readonly theme: ThemeWire
  readonly context: MoveContext
}

function ThemeRow({ theme, context }: ThemeRowProps) {
  const answer = context.answer.value
  const refusal =
    answer?.isRefused === true && answer.themeId === theme.id ? answer.text : undefined

  return (
    <div class="theme-row">
      <div class="theme-head">
        <b>{theme.title}</b>
        <ThemeActions theme={theme} context={context} />
      </div>
      {refusal !== undefined && (
        <p class="failure-line" role="alert">
          {refusal}
        </p>
      )}
    </div>
  )
}

// One move at a time: the buttons stay off from the click to the daemon's answer.
function ThemeActions({ theme, context }: ThemeRowProps) {
  const isBusy = useSignal(false)

  if (theme.status !== PROPOSED) {
    return <TrackedActions theme={theme} context={context} />
  }

  const move = async (transition: ThemeTransitionWire): Promise<void> => {
    isBusy.value = true

    try {
      await sendMove(theme, transition, context)
    } catch (error: unknown) {
      context.answer.value = { themeId: theme.id, text: toErrorText(error), isRefused: true }
    } finally {
      isBusy.value = false
    }
  }

  return (
    <>
      <Button
        size="small"
        disabled={isBusy.value}
        onClick={() => move('approve').catch(() => undefined)}
      >
        {tr('ui.office.themes.follow')}
      </Button>
      <Button
        size="small"
        disabled={isBusy.value}
        onClick={() => move('reject').catch(() => undefined)}
      >
        {tr('ui.office.themes.skip')}
      </Button>
    </>
  )
}

// A followed theme re-reads on its own; an invalidated one only waits to be stopped.
function TrackedActions({ theme, context }: ThemeRowProps) {
  return (
    <>
      {theme.status !== INVALIDATED && (
        <RunButton
          command={`${RUN_ONE_TEXT} ${theme.id}`}
          label={tr('ui.office.themes.rerun')}
          busyLabel={tr('ui.office.themes.running')}
          kind="ai"
          size="small"
          disabled={!isModelReady.value}
          isQuiet
        />
      )}
      <Button size="small" onClick={() => askStop(theme, context)}>
        {tr('ui.office.themes.stop')}
      </Button>
    </>
  )
}

// Stopping is asked once; a refusal keeps the dialog open with the daemon's sentence.
function askStop(theme: ThemeWire, context: MoveContext): void {
  askConfirm({
    title: tr('ui.office.themes.stop'),
    lines: [tr('ui.office.themes.stopAsk', { title: theme.title })],
    confirmLabel: tr('ui.office.themes.stop'),
    isDestructive: true,
    confirm: () => sendMove(theme, 'retire', context),
  })
}

async function sendMove(
  theme: ThemeWire,
  transition: ThemeTransitionWire,
  context: MoveContext
): Promise<void> {
  const result = await sendJson('POST', ROUTES.themeTransition(theme.id, transition))

  context.answer.value = { themeId: theme.id, text: result.text, isRefused: false }
  context.reread()
}
