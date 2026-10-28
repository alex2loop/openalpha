import type { SuggestionWire, TradingTrackRecordResponse } from '@/app/server/wire/trading'
import { pluralKey } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { SHARED_FOCUS } from '@/web/state/agents'
import { useBlock } from '@/web/state/block'
import { formatFixedFraction } from '@/web/text/figures'
import { isNoteLine } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { useUnstripped } from '@/web/ui/kit/cautions'
import { ClockIcon } from '@/web/ui/kit/icons'
import { NoteList } from '@/web/ui/markdown/report-notes'
import { openWhy } from '@/web/ui/ticker/why-dialog'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** Thành tích: how the calls the daemon scored turned out, in `/reflect`'s own lines. */
export function TrackRecord() {
  const reading = useBlock(ROUTES.trackRecord)

  return (
    <BlockFrame
      title={tr('ui.office.ideas.record')}
      colour="green"
      icon={<ClockIcon />}
      reading={reading}
    >
      {(record) => <RecordBody record={record} />}
    </BlockFrame>
  )
}

function RecordBody({ record }: { readonly record: TradingTrackRecordResponse }) {
  const { summary, text } = record

  if (summary.resolvedCount === 0) {
    return <p class="meta">{tr('ui.office.record.empty')}</p>
  }

  return (
    <>
      <Lines lines={text.summary} isLead />
      <div class="stack">
        <Hits summary={summary} />
        <Lines lines={text.byConviction} />
      </div>
      <Lines lines={text.acted} />
      <div class="row-list">
        {text.closed.map((closed) => (
          <ClosedRow
            key={closed.suggestionId}
            line={closed.line}
            call={findCall(record, closed.suggestionId)}
          />
        ))}
      </div>
      <ByModel models={summary.byModel} />
    </>
  )
}

interface LinesProps {
  readonly lines: readonly string[]
  /** The first line heads the rest. */
  readonly isLead?: boolean
}

// The daemon's figure lines as paragraphs, its cautions after them as one compact list.
function Lines({ lines, isLead = false }: LinesProps) {
  const shown = useUnstripped(lines)
  const figures = shown.filter((line) => !isNoteLine(line))

  return (
    <>
      {figures.length > 0 && (
        <div class="stack">
          {figures.map((line, index) => (
            <p key={line} class={isLead && index === 0 ? 'lead' : undefined}>
              {line}
            </p>
          ))}
        </div>
      )}
      <NoteList lines={shown.filter(isNoteLine)} />
    </>
  )
}

// The targets reached: the one count the daemon's lines do not state. The rate, the index beaten
// and the small-sample warning stay with the daemon's summary lines.
function Hits({ summary }: { readonly summary: TradingTrackRecordResponse['summary'] }) {
  const own = summary.focuses.find((focus) => focus.focusKey === SHARED_FOCUS)

  if (own === undefined) {
    return null
  }

  return (
    <p>
      {tr(pluralKey(own.resolvedCount, 'ui.office.record.hitsOne', 'ui.office.record.hits'), {
        hit: own.targetCount,
        count: own.resolvedCount,
      })}
    </p>
  )
}

interface ClosedRowProps {
  readonly line: string
  readonly call: SuggestionWire | undefined
}

function ClosedRow({ line, call }: ClosedRowProps) {
  return (
    <div class="record-closed">
      <span>{line}</span>
      {call !== undefined && (
        <Button kind="tertiary" size="small" onClick={() => openWhy({ kind: 'past', call })}>
          {tr('ui.office.ticker.why')}
        </Button>
      )}
    </div>
  )
}

function findCall(
  record: TradingTrackRecordResponse,
  suggestionId: string
): SuggestionWire | undefined {
  return record.recent.find((call) => call.id === suggestionId)
}

function ByModel({
  models,
}: {
  readonly models: TradingTrackRecordResponse['summary']['byModel']
}) {
  if (models.length === 0) {
    return null
  }

  return (
    <>
      <h3 class="sub-head">{tr('ui.office.record.byModel')}</h3>
      <div class="row-list">
        {models.map((model) => (
          <div key={model.model} class="record-model">
            <span>{model.model}</span>
            <span>{`${model.winCount}/${model.resolvedCount}`}</span>
            <span>{formatFixedFraction(model.winRate)}</span>
          </div>
        ))}
      </div>
    </>
  )
}
