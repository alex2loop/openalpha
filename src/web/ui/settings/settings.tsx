import type { JSX } from 'preact'
import { signal } from '@preact/signals'

import { pluralKey } from '@/i18n'
import {
  pendingRestart,
  SECTION_TITLES,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '@/web/state/settings'
import { loadUpdate } from '@/web/state/update'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import {
  BookIcon,
  ChatIcon,
  ClockIcon,
  CoinIcon,
  CpuIcon,
  EyeIcon,
  LockIcon,
  PlugIcon,
  TargetIcon,
  TrendIcon,
  UserIcon,
} from '@/web/ui/kit/icons'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { AdvancedSection } from '@/web/ui/settings/advanced'
import { AgentsSection } from '@/web/ui/settings/agents-section'
import { ChannelsSection } from '@/web/ui/settings/channels'
import { ExchangesSection } from '@/web/ui/settings/credentials/exchanges'
import { ProvidersSection } from '@/web/ui/settings/credentials/providers'
import { ToolsSection } from '@/web/ui/settings/credentials/tools'
import { DataSection } from '@/web/ui/settings/data-section'
import { DisplaySection } from '@/web/ui/settings/display'
import { MemorySection } from '@/web/ui/settings/memory'
import { ProfileSection } from '@/web/ui/settings/profile-forms'
import { openRestartDialog } from '@/web/ui/settings/restart'
import { describeRows } from '@/web/ui/settings/restart-rows'
import { ScheduleSection } from '@/web/ui/settings/schedule-section'
import { UpdateStrip } from '@/web/ui/settings/update-strip'

import '@/web/ui/dialogs/dialogs.css'
import './settings.css'

// Each section's tile in the nav, by the mockup's palette.
const SECTION_TILES: Readonly<
  Record<SettingsSection, { readonly colour: string; readonly icon: JSX.Element }>
> = Object.freeze({
  profile: { colour: 'green', icon: <UserIcon /> },
  memory: { colour: 'yellow', icon: <BookIcon /> },
  schedule: { colour: 'blue', icon: <ClockIcon /> },
  agents: { colour: 'peach', icon: <CpuIcon /> },
  channels: { colour: 'pink', icon: <ChatIcon /> },
  providers: { colour: 'yellow', icon: <CoinIcon /> },
  exchanges: { colour: 'green', icon: <TrendIcon /> },
  tools: { colour: 'teal', icon: <TargetIcon /> },
  data: { colour: 'teal', icon: <PlugIcon /> },
  display: { colour: 'gray', icon: <EyeIcon /> },
  advanced: { colour: 'gray', icon: <LockIcon /> },
})

// The section last open, so the way back from a form lands where the operator left.
const chosen = signal<SettingsSection>('profile')

/** Opens Cài đặt on `section`, or on the one last open. */
export function openSettings(section?: SettingsSection): void {
  if (section !== undefined) {
    chosen.value = section
  }

  loadUpdate(new AbortController().signal).catch(() => undefined)
  openModal({
    title: tr('ui.office.settings.title'),
    body: <SettingsBody />,
    footer: <SettingsFooter />,
    wide: true,
  })
}

function reopen(): void {
  openSettings()
}

function openSection(section: SettingsSection): void {
  chosen.value = section
}

function SettingsBody() {
  return (
    <div class="settings">
      <nav class="settings-nav" aria-label={tr('ui.office.settings.title')}>
        {SETTINGS_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            class={section === chosen.value ? 'is-on' : ''}
            aria-current={section === chosen.value ? 'page' : undefined}
            onClick={() => {
              chosen.value = section
            }}
          >
            <span class="tile" style={`--c: var(--tc-${SECTION_TILES[section].colour})`}>
              {SECTION_TILES[section].icon}
            </span>
            {tr(SECTION_TITLES[section])}
          </button>
        ))}
      </nav>
      <div class="settings-form">
        <UpdateStrip reopen={reopen} />
        <h3 class="settings-section">{tr(SECTION_TITLES[chosen.value])}</h3>
        <SectionView section={chosen.value} />
      </div>
    </div>
  )
}

function SectionView({ section }: { readonly section: SettingsSection }) {
  switch (section) {
    case 'profile':
      return <ProfileSection reopen={reopen} />
    case 'memory':
      return <MemorySection reopen={reopen} />
    case 'schedule':
      return <ScheduleSection reopen={reopen} />
    case 'agents':
      return <AgentsSection />
    case 'channels':
      return <ChannelsSection />
    case 'providers':
      return <ProvidersSection reopen={reopen} openSection={openSection} />
    case 'exchanges':
      return <ExchangesSection reopen={reopen} />
    case 'tools':
      return <ToolsSection reopen={reopen} />
    case 'data':
      return <DataSection openSection={openSection} />
    case 'display':
      return <DisplaySection reopen={reopen} />
    case 'advanced':
      return <AdvancedSection />
  }
}

// What waits for a restart, with the way to do it; with nothing pending, how saving works and a
// plain restart.
function SettingsFooter() {
  const rows = pendingRestart.value

  if (rows.length === 0) {
    return (
      <>
        <div class="dialog-foot-left">
          <span class="dialog-note">{tr('ui.office.settings.footNote')}</span>
        </div>
        <Button onClick={() => openRestartDialog({ onBack: reopen })}>
          {tr('ui.office.restart.title')}
        </Button>
        <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>
      </>
    )
  }

  return (
    <>
      <div class="dialog-foot-left">
        <span class="dialog-note">
          {tr(
            pluralKey(
              rows.length,
              'ui.office.settings.pendingTitleOne',
              'ui.office.settings.pendingTitle'
            ),
            {
              count: rows.length,
              keys: describeRows(rows),
            }
          )}
        </span>
      </div>
      <Button onClick={closeModal}>{tr('ui.office.settings.later')}</Button>
      <Button onClick={() => openRestartDialog({ onBack: reopen })}>
        {tr('ui.office.settings.restartCta')}
      </Button>
    </>
  )
}
