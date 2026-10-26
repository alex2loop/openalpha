import { useMemo } from 'preact/hooks'

import type { StatePayload } from '@/app/server/wire/system'
import type { MessageKey } from '@/i18n'
import { authState, clearToken } from '@/web/api/token'
import {
  COLOUR_PAIRS,
  type ColourPair,
  colourPair,
  lightByHour,
  MOTIONS,
  type Motion,
  motion,
  setColourPair,
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
import { ActionRow, SettingRow, useDraft } from '@/web/ui/settings/row'

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
const MOTION_LABELS = Object.freeze({
  system: 'ui.office.common.followSystem',
  reduced: 'ui.office.settings.motionReduced',
  full: 'ui.office.settings.motionFull',
} as const satisfies Record<Motion, MessageKey>)
// why-safe: the keys of a `Record<Language, ...>` are exactly `Language`.
const LANGUAGES = Object.keys(LANGUAGE_LABELS) as readonly Language[]

/** Hiển thị: the language and time zone the daemon uses (read once at start), and how this page
 *  looks in this browser (applies at once). */
export function DisplaySection() {
  return (
    <>
      <LanguageRow />
      <TimeZoneRow />
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
      <LightByHourRow />
      <AttentionRows />
      <ConnectionRow />
    </>
  )
}

function LanguageRow() {
  const { draft, isChanged, markSaved } = useDraft<Language>(
    state.value?.locale ?? LANGUAGES[0] ?? 'vi'
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

function ConnectionRow() {
  return (
    <ActionRow title={tr('ui.office.settings.connection')}>
      <Button
        size="small"
        kind="destructive"
        onClick={() => {
          clearToken()
          authState.value = 'missing'
        }}
      >
        {tr('ui.office.settings.signOut')}
      </Button>
    </ActionRow>
  )
}

// The zones the browser knows, with the daemon's own first when the browser lacks it.
function listTimeZones(current: string): readonly string[] {
  const zones = Intl.supportedValuesOf('timeZone')

  return current === '' || zones.includes(current) ? zones : [current, ...zones]
}
