import type { MacroResponse } from '@/app/server/wire/market'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { isAdvanced } from '@/web/state/prefs'
import { formatFixed, formatFixedFraction, PERCENT } from '@/web/text/figures'
import { joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { GlobeIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { MACRO_POLL_MS, MacroReading } from '@/web/ui/today/blocks/macro'

const SCORE_DIGITS = 2
const LEVEL_DIGITS = 2
const INFO_SEVERITY = 'info'
// Where a driver with no band between its two ends sits.
const MIDDLE_POSITION = 0.5

type ReadyMacro = Extract<MacroResponse, { readonly status: 'ready' }>
type MacroDriver = ReadyMacro['drivers'][number]

/** The region's macro reading in full: the regime and lean at every level, what is missing and how
 *  much of the model read in; in Nâng cao also the scale and the drivers behind the score. */
export function MacroFull({ region }: { readonly region: string }) {
  const reading = useBlock(ROUTES.macro, { query: { region }, everyMs: MACRO_POLL_MS })

  return (
    <BlockFrame
      title={tr('trading.brief.block.macro')}
      colour="blue"
      icon={<GlobeIcon />}
      reading={reading}
      dataTo={reading.data?.status === 'ready' ? reading.data.asOf : undefined}
    >
      {(macro) => (
        <>
          <MacroReading macro={macro} />
          {macro.status === 'ready' && <MacroDetail macro={macro} />}
          <InfoNotes caveats={macro.caveats} />
        </>
      )}
    </BlockFrame>
  )
}

function MacroDetail({ macro }: { readonly macro: ReadyMacro }) {
  const range = macro.scoreRange

  return (
    <>
      {macro.missing.length > 0 && (
        <p class="meta">
          {tr('ui.office.market.missing', {
            names: joinList(macro.missing.map((driver) => driver.label)),
          })}
        </p>
      )}
      {macro.coverage < 1 && (
        <p class="meta">
          {tr('ui.office.market.coverage', { share: formatFixedFraction(macro.coverage) })}
        </p>
      )}
      {isAdvanced.value && (
        <>
          <p class="meta">
            {tr('ui.office.market.scale', {
              score: formatFixed(macro.score, SCORE_DIGITS),
              min: formatFixed(range.min, SCORE_DIGITS),
              max: formatFixed(range.max, SCORE_DIGITS),
              on: formatFixed(range.riskOnAt, SCORE_DIGITS),
              off: formatFixed(range.riskOffAt, SCORE_DIGITS),
            })}
          </p>
          <DriverTable drivers={macro.drivers} />
        </>
      )}
    </>
  )
}

function DriverTable({ drivers }: { readonly drivers: ReadyMacro['drivers'] }) {
  const ranked = [...drivers].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))

  return (
    <>
      <h3 class="market-sub">{tr('ui.office.market.drivers')}</h3>
      <p class="meta">{tr('ui.office.market.driversNote')}</p>
      <table class="macro-drivers">
        <thead>
          <tr>
            <th />
            <th>{tr('ui.office.market.col.reading')}</th>
            <th>{tr('ui.office.market.col.position')}</th>
            <th>{tr('ui.office.market.col.weight')}</th>
            <th>{tr('ui.office.market.col.contribution')}</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((driver) => (
            <DriverRow key={driver.id} driver={driver} />
          ))}
        </tbody>
      </table>
    </>
  )
}

function DriverRow({ driver }: { readonly driver: MacroDriver }) {
  return (
    <tr>
      <td>{driver.label}</td>
      <td class="num">
        {driver.unit === 'percent'
          ? formatFixedFraction(driver.value / PERCENT)
          : formatFixed(driver.value, LEVEL_DIGITS)}
      </td>
      <td>
        <span class="macro-track">
          <span class="macro-dot" style={`left: ${positionOf(driver) * PERCENT}%`} />
        </span>
      </td>
      <td class="num">{formatFixedFraction(driver.weight)}</td>
      <td class="num">{formatFixed(driver.contribution, SCORE_DIGITS)}</td>
    </tr>
  )
}

// 0 at `bearishAt`, 1 at `bullishAt`, clamped: a band may run either way up.
function positionOf(driver: MacroDriver): number {
  const span = driver.bullishAt - driver.bearishAt

  if (span === 0) {
    return MIDDLE_POSITION
  }

  return Math.min(1, Math.max(0, (driver.value - driver.bearishAt) / span))
}

// The daemon's by-design notes; its warnings already stand at the top of the block.
function InfoNotes({ caveats }: { readonly caveats: MacroResponse['caveats'] }) {
  const notes = caveats.filter((caveat) => caveat.severity === INFO_SEVERITY)

  if (notes.length === 0) {
    return null
  }

  return (
    <Fold title={tr('trading.render.suggestion.sources')}>
      {notes.map((note) => (
        <p key={note.text} class="meta">
          {note.text}
        </p>
      ))}
    </Fold>
  )
}
