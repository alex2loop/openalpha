import type { ComponentChildren } from 'preact'

import type { BlockReading } from '@/web/state/block'
import { formatDay, type MessageKey } from '@/i18n'
import { locale, state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { openSettings } from '@/web/ui/settings/settings'

import './today.css'

/** A block's hue, from the `--tc-*` tokens. */
type TileColour = 'yellow' | 'green' | 'blue' | 'pink' | 'peach' | 'teal' | 'gray'

interface BlockFrameProps<T> {
  readonly title: string
  readonly colour: TileColour
  readonly icon: ComponentChildren
  readonly reading: BlockReading<T>
  /** The trading day the figures describe (`YYYY-MM-DD`). */
  readonly dataTo?: string | undefined
  /** The words "{time}" follows on the read line; "Đọc lúc" unless the figures are valuations. */
  readonly readKey?: MessageKey
  /** False where the figures say their own read time, so it is not said twice. */
  readonly showReadLine?: boolean
  /** A link or button in the head, at the right. */
  readonly action?: ComponentChildren
  /** Said under the skeleton while the first read runs, for a read that takes seconds. */
  readonly loadingText?: string | undefined
  /** Said in place of the generic failure, where a failed read must not pass for an empty one. */
  readonly failedText?: string | undefined
  /** The block's figures; called only when there is a read to show. */
  readonly children: (data: T) => ComponentChildren
}

/** One Hôm nay block: its title tile, the daemon's cautions, a failed read with "Thử lại" over the
 *  last good figures, or the grey line of a part this daemon does not run. */
export function BlockFrame<T>(props: BlockFrameProps<T>) {
  const { title, colour, icon, reading, action, children } = props

  return (
    <section class="block">
      <BlockHead title={title} colour={colour} icon={icon}>
        {reading.state !== 'absent' && action}
      </BlockHead>
      {reading.state === 'absent' ? (
        <p class="meta">{tr('ui.office.today.absent', { what: title })}</p>
      ) : (
        <BlockBody {...props}>{children}</BlockBody>
      )}
    </section>
  )
}

interface BlockHeadProps {
  readonly title: string
  readonly colour: TileColour
  readonly icon: ComponentChildren
  /** A link or button at the right. */
  readonly children?: ComponentChildren
}

/** A card's title on its colour tile, as every block in the panel heads itself. */
export function BlockHead({ title, colour, icon, children }: BlockHeadProps) {
  return (
    <h2 class="block-head">
      <span class="tile" style={`--c: var(--tc-${colour})`}>
        {icon}
      </span>
      {title}
      <span class="block-grow" />
      {children}
    </h2>
  )
}

function BlockBody<T>(props: BlockFrameProps<T>) {
  const { title, reading, dataTo, readKey, loadingText, failedText, children } = props
  const { showReadLine = true } = props
  const { data } = reading

  return (
    <>
      {reading.cautions.map((text) => (
        <p key={text} class="strip is-caution">
          {text}
        </p>
      ))}
      {reading.state === 'failed' && (
        <FailedStrip title={title} reading={reading} failedText={failedText} />
      )}
      {data === undefined ? (
        reading.state === 'loading' && (
          <>
            <Skeleton shape="rows" />
            {loadingText !== undefined && <p class="meta">{loadingText}</p>}
          </>
        )
      ) : (
        <>
          {children(data)}
          {showReadLine && <ReadLine readAt={reading.readAt} dataTo={dataTo} readKey={readKey} />}
        </>
      )}
    </>
  )
}

type FailedStripProps<T> = Pick<BlockFrameProps<T>, 'title' | 'reading' | 'failedText'>

function FailedStrip<T>({ title, reading, failedText }: FailedStripProps<T>) {
  return (
    <div class="strip is-problem" role="alert">
      <span>{failedText ?? failureSentence(title, reading)}</span>
      <Button kind="tertiary" onClick={reading.retry}>
        {tr('ui.office.common.retry')}
      </Button>
      <Button kind="tertiary" onClick={() => openSettings('data')}>
        {tr('ui.office.today.doctor')}
      </Button>
    </div>
  )
}

function failureSentence<T>(title: string, reading: BlockReading<T>): string {
  const { error, readAt } = reading
  const reason = error === undefined ? '' : toFailureText(error)
  const timeZone = state.value?.timeZone

  if (readAt === undefined || timeZone === undefined) {
    return tr('ui.office.today.failedNone', { what: title, reason })
  }

  return tr('ui.office.today.failed', { what: title, reason, time: formatClock(readAt, timeZone) })
}

interface ReadLineProps {
  readonly readAt: number | undefined
  readonly dataTo: string | undefined
  readonly readKey: MessageKey | undefined
}

function ReadLine({ readAt, dataTo, readKey = 'ui.office.today.readAt' }: ReadLineProps) {
  const timeZone = state.value?.timeZone

  if (readAt === undefined || timeZone === undefined) {
    return null
  }

  const facts = [
    ...(dataTo === undefined
      ? []
      : [tr('ui.office.today.dataTo', { time: formatDay(locale.value, dataTo) })]),
    tr(readKey, { time: formatClock(readAt, timeZone) }),
  ]

  return <p class="meta block-read">{joinInline(facts)}</p>
}
