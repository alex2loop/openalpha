import type { MacroResponse } from '@/app/server/wire/market'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { editionKey, isAnalysisOnly } from '@/web/state/edition'
import { isAdvanced } from '@/web/state/prefs'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { toCaveatText } from '@/web/text/caveat-text'
import {
  formatCount,
  formatFixed,
  formatFixedFraction,
  formatPercent,
  PERCENT,
} from '@/web/text/figures'
import { joinInline, joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { GlobeIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import {
  formatDriverValue,
  MACRO_POLL_MS,
  type MacroDriver,
  MacroReading,
  type ReadyMacro,
} from '@/web/ui/today/blocks/macro'

const SCORE_DIGITS = 2
const INFO_SEVERITY = 'info'
const DEPOSIT_RATE_SERIES = 'deposit-rate-12m'
const USD_VND_SERIES = 'usd-vnd'
const UNSERVED_REASON = 'unserved'
// Where a driver with no band between its two ends sits.
const MIDDLE_POSITION = 0.5

/** The region's macro reading in full: the regime and lean at every level, what is missing and how
 *  much of the model read in; in Nâng cao also the scale and the drivers behind the score. */
export function MacroFull({ region }: { readonly region: string }) {
  const reading = useBlock(ROUTES.macro, { query: { region }, everyMs: MACRO_POLL_MS })

  useRereadAfterRefresh(reading.retry)

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
          <MacroReading
            macro={macro}
            detail={isAdvanced.value && !isAnalysisOnly.value ? DriverDetail : undefined}
          />
          {macro.status === 'ready' && <MacroDetail macro={macro} />}
          <InfoNotes caveats={macro.caveats} />
        </>
      )}
    </BlockFrame>
  )
}

function MacroDetail({ macro }: { readonly macro: ReadyMacro }) {
  const range = macro.scoreRange
  const reading = readingLines(macro)

  return (
    <div class="stack meta">
      <RatesLine readings={macro.readings} />
      {reading.length > 0 && <p>{joinInline(reading)}</p>}
      {isAdvanced.value && !isAnalysisOnly.value && (
        <p>
          {tr('ui.office.market.scale', {
            score: formatFixed(macro.score, SCORE_DIGITS),
            min: formatFixed(range.min, SCORE_DIGITS),
            max: formatFixed(range.max, SCORE_DIGITS),
            on: formatFixed(range.riskOnAt, SCORE_DIGITS),
            off: formatFixed(range.riskOffAt, SCORE_DIGITS),
          })}
        </p>
      )}
    </div>
  )
}

// What the read left out and how much of the model it covers, one line each where there is any.
function readingLines(macro: ReadyMacro): string[] {
  const unserved = macro.missing.filter((driver) => driver.reason === UNSERVED_REASON)
  const absent = macro.missing.filter((driver) => driver.reason !== UNSERVED_REASON)

  return [
    ...(absent.length === 0
      ? []
      : [
          tr(editionKey('ui.office.market.missing', 'ui.office.market.missingWeb'), {
            names: joinList(absent.map((driver) => driver.label)),
          }),
        ]),
    ...(unserved.length === 0
      ? []
      : [
          tr('ui.office.market.unserved', {
            names: joinList(unserved.map((driver) => driver.label)),
          }),
        ]),
    ...(macro.coverage < 1 ? [coverageLine(macro)] : []),
  ]
}

// The daemon states the share of the model that read in; the web edition, which has no model to
// cover, states how many of the series did.
function coverageLine(macro: ReadyMacro): string {
  if (!isAnalysisOnly.value) {
    return tr('ui.office.market.coverage', { share: formatFixedFraction(macro.coverage) })
  }

  return tr('ui.office.market.coverageWeb', {
    read: macro.drivers.length,
    total: macro.drivers.length + macro.missing.length,
  })
}

// The deposit rate and the exchange rate the region's read carried, each left out when it has none.
function RatesLine({ readings }: { readonly readings: ReadyMacro['readings'] }) {
  const depositRate = readings[DEPOSIT_RATE_SERIES]
  const usdVnd = readings[USD_VND_SERIES]
  const rates = [
    ...(depositRate === undefined
      ? []
      : [tr('ui.office.market.depositRate', { rate: formatPercent(depositRate) })]),
    ...(usdVnd === undefined ? [] : [tr('ui.office.market.usdVnd', { rate: formatCount(usdVnd) })]),
  ]

  return rates.length === 0 ? null : <p>{joinInline(rates)}</p>
}

/** Under a driver's reading in Nâng cao: where it sits between its bearish and bullish ends, and
 *  its weight and pull on the composite. */
function DriverDetail(driver: MacroDriver) {
  return (
    <div class="meta macro-detail">
      <span class="macro-range">
        <span class="num">{formatDriverValue({ unit: driver.unit, value: driver.bearishAt })}</span>
        <span class="macro-track">
          <span class="macro-dot" style={`left: ${positionOf(driver) * PERCENT}%`} />
        </span>
        <span class="num">{formatDriverValue({ unit: driver.unit, value: driver.bullishAt })}</span>
      </span>
      <span>
        {joinInline([
          `${tr('ui.office.market.col.weight')} ${formatFixedFraction(driver.weight)}`,
          `${tr('ui.office.market.col.contribution')} ${formatFixed(driver.contribution, SCORE_DIGITS)}`,
        ])}
      </span>
    </div>
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
          {toCaveatText(note)}
        </p>
      ))}
    </Fold>
  )
}
