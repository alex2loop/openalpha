import { useMemo } from 'preact/hooks'

import type { MarketWire } from '@/app/server/wire/market'
import type { StatePayload } from '@/app/server/wire/system'
import type { MessageKey } from '@/i18n'
import { LanguageRow as EditionLanguageRow } from '@/web/edition/language-row'
import { isAnalysisOnly } from '@/web/state/edition'
import { homeRegion, knownMarkets } from '@/web/state/market'
import {
  COLOUR_PAIRS,
  type ColourPair,
  colourPair,
  DETAIL_LEVELS,
  type DetailLevel,
  detailLevel,
  lightByHour,
  MOTIONS,
  type Motion,
  motion,
  setColourPair,
  setDetailLevel,
  setLightByHour,
  setMotion,
  setTheme,
  THEMES,
  type Theme,
  theme,
} from '@/web/state/prefs'
import { state } from '@/web/state/session'
import { isTree, saveConfig } from '@/web/state/settings'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Segmented } from '@/web/ui/kit/segmented'
import { AttentionRows } from '@/web/ui/settings/attention-rows'
import { BrowserSessionsRow } from '@/web/ui/settings/browser-sessions'
import { ActionRow, type SectionProps, SettingRow, useDraft } from '@/web/ui/settings/row'
import { openUpdateDialog } from '@/web/ui/settings/update-dialog'

type Language = StatePayload['locale']

const LANGUAGE_LABELS = Object.freeze({
  vi: 'ui.office.settings.langVi',
  en: 'ui.office.settings.langEn',
} as const satisfies Record<Language, MessageKey>)
const THEME_LABELS = Object.freeze({
  system: 'ui.office.common.followSystem',
  light: 'ui.office.settings.themeLight',
  dark: 'ui.office.settings.themeDark',
} as const satisfies Record<Theme, MessageKey>)
const COLOUR_LABELS = Object.freeze({
  'green-up': 'ui.office.settings.coloursGreenUp',
  'red-up': 'ui.office.settings.coloursRedUp',
} as const satisfies Record<ColourPair, MessageKey>)
const DETAIL_LABELS = Object.freeze({
  simple: 'ui.office.settings.detailSimple',
  advanced: 'ui.office.settings.detailAdvanced',
} as const satisfies Record<DetailLevel, MessageKey>)
const MOTION_LABELS = Object.freeze({
  system: 'ui.office.common.followSystem',
  reduced: 'ui.office.settings.motionReduced',
  full: 'ui.office.settings.motionFull',
} as const satisfies Record<Motion, MessageKey>)
// why-safe: the keys of a `Record<Language, ...>` are exactly `Language`.
const LANGUAGES = Object.keys(LANGUAGE_LABELS) as readonly Language[]

/** Hiển thị: the daemon's version, the language and time zone it uses (read once at start), and
 *  how this page looks in this browser (applies at once). */
export function DisplaySection({ reopen }: SectionProps) {
  const isWeb = isAnalysisOnly.value

  return (
    <>
      {!isWeb && <VersionRow reopen={reopen} />}
      {isWeb ? <EditionLanguageRow /> : <LanguageRow />}
      {!isWeb && <HomeMarketRow />}
      {!isWeb && <TimeZoneRow />}
      <PreferenceRow
        title={tr('ui.office.settings.colours')}
        note={tr('ui.office.settings.coloursNote')}
        value={colourPair.value}
        options={COLOUR_PAIRS.map((value) => ({ value, label: tr(COLOUR_LABELS[value]) }))}
        onChange={setColourPair}
      />
      <PreferenceRow
        title={tr('ui.office.settings.theme')}
        value={theme.value}
        options={THEMES.map((value) => ({ value, label: tr(THEME_LABELS[value]) }))}
        onChange={setTheme}
      />
      <PreferenceRow
        title={tr('ui.office.settings.motion')}
        value={motion.value}
        options={MOTIONS.map((value) => ({ value, label: tr(MOTION_LABELS[value]) }))}
        onChange={setMotion}
      />
      <DetailRow />
      <LightByHourRow />
      {!isWeb && <AttentionRows />}
      {!isWeb && <BrowserSessionsRow />}
    </>
  )
}

// The daemon's version; the dialog says whether a newer one is out.
function VersionRow({ reopen }: SectionProps) {
  const title = tr('ui.office.update.version')

  return (
    <ActionRow title={title} summary={state.value?.version ?? ''}>
      <Button size="small" onClick={() => openUpdateDialog({ onBack: reopen })}>
        {tr('ui.office.update.notes')}
      </Button>
    </ActionRow>
  )
}

function LanguageRow() {
  const { draft, isChanged, markSaved } = useDraft<Language>(
    state.value?.locale ?? LANGUAGES[0] ?? 'en'
  )
  const title = tr('ui.office.settings.language')

  return (
    <SettingRow
      title={title}
      note={tr('ui.office.settings.languageNote')}
      timing="restart"
      isChanged={isChanged}
      onSave={async () => {
        await saveConfig(
          (tree) => ({
            ...tree,
            locale: { ...(isTree(tree.locale) ? tree.locale : {}), language: draft.value },
          }),
          'language'
        )
        markSaved()
      }}
    >
      <Segmented
        label={title}
        value={draft.value}
        options={LANGUAGES.map((value) => ({ value, label: tr(LANGUAGE_LABELS[value]) }))}
        onChange={(value) => {
          draft.value = value
        }}
      />
    </SettingRow>
  )
}

/** The regions a home can be: those whose own market writes a morning brief (world gold owns a
 *  region but is read for reference only). Shown once the markets are read, so the draft starts
 *  from the region in use. */
function HomeMarketRow() {
  const homes = knownMarkets.value.filter((market) => market.ownsRegion && market.hasBrief)
  const current = homeRegion()

  return current === undefined || homes.length < 2 ? null : (
    <HomeMarketChoice key={current} homes={homes} current={current} />
  )
}

function HomeMarketChoice(props: {
  readonly homes: readonly MarketWire[]
  readonly current: string
}) {
  const { draft, isChanged, markSaved } = useDraft(props.current)
  const title = tr('ui.office.settings.homeMarket')

  return (
    <SettingRow
      title={title}
      note={tr('ui.office.settings.homeMarketNote')}
      timing="restart"
      isChanged={isChanged}
      onSave={async () => {
        await saveConfig(
          (tree) => ({
            ...tree,
            locale: { ...(isTree(tree.locale) ? tree.locale : {}), region: draft.value },
          }),
          'homeMarket'
        )
        markSaved()
      }}
    >
      <Segmented
        label={title}
        value={draft.value}
        options={props.homes.map((market) => ({ value: market.region, label: market.regionLabel }))}
        onChange={(value) => {
          draft.value = value
        }}
      />
    </SettingRow>
  )
}

function TimeZoneRow() {
  const current = state.value?.timeZone ?? ''
  const { draft, isChanged, markSaved } = useDraft(current)
  const zones = useMemo(() => listTimeZones(current), [current])
  const title = tr('ui.office.settings.timeZone')

  return (
    <SettingRow
      title={title}
      note={tr('ui.office.settings.timeZoneNote')}
      timing="restart"
      isChanged={isChanged}
      current={tr('ui.office.settings.current', { value: current })}
      onSave={async () => {
        await saveConfig(
          (tree) => ({
            ...tree,
            locale: { ...(isTree(tree.locale) ? tree.locale : {}), timezone: draft.value },
          }),
          'timeZone'
        )
        markSaved()
      }}
    >
      <select
        aria-label={title}
        value={draft.value}
        onChange={(event) => {
          draft.value = event.currentTarget.value
        }}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
    </SettingRow>
  )
}

interface PreferenceRowProps<T extends string> {
  readonly title: string
  readonly note?: string
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (value: T) => void
}

// A choice kept in this browser: it applies the moment it is pressed, so there is nothing to save.
function PreferenceRow<T extends string>({
  title,
  note,
  value,
  options,
  onChange,
}: PreferenceRowProps<T>) {
  return (
    <ActionRow title={title} {...(note === undefined ? {} : { note })}>
      <Segmented label={title} value={value} options={options} onChange={onChange} />
    </ActionRow>
  )
}

// Kept in this browser like the choices above: it applies the moment it is ticked.
function LightByHourRow() {
  const title = tr('ui.office.settings.lightByHour')

  return (
    <ActionRow title={title}>
      <label>
        <input
          type="checkbox"
          checked={lightByHour.value}
          onChange={(event) => setLightByHour(event.currentTarget.checked)}
        />
        {tr('ui.office.settings.lightByHourOn')}
      </label>
    </ActionRow>
  )
}

// The zones the browser knows, with the daemon's own first when the browser lacks it.
function listTimeZones(current: string): readonly string[] {
  const zones = Intl.supportedValuesOf('timeZone')

  return current === '' || zones.includes(current) ? zones : [current, ...zones]
}

// The web edition has no scores to tuck away, so its note does not name them.
function DetailRow() {
  const note = isAnalysisOnly.value
    ? 'ui.office.settings.detailNotePlain'
    : 'ui.office.settings.detailNote'

  return (
    <PreferenceRow
      title={tr('ui.office.settings.detail')}
      note={tr(note)}
      value={detailLevel.value}
      options={DETAIL_LEVELS.map((value) => ({ value, label: tr(DETAIL_LABELS[value]) }))}
      onChange={setDetailLevel}
    />
  )
}
