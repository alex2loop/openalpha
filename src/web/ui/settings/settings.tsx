import { signal } from '@preact/signals'

import type { MessageKey } from '@/i18n'
import { pluralKey } from '@/i18n'
import { pendingRestart, SETTINGS_SECTIONS, type SettingsSection } from '@/web/state/settings'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { AdvancedSection } from '@/web/ui/settings/advanced'
import { AgentsSection } from '@/web/ui/settings/agents-section'
import { ChannelsSection } from '@/web/ui/settings/channels'
import { DataSection } from '@/web/ui/settings/data-section'
import { DisplaySection } from '@/web/ui/settings/display'
import { ProfileSection } from '@/web/ui/settings/profile-forms'
import { openRestartDialog } from '@/web/ui/settings/restart'
import { describeRows } from '@/web/ui/settings/restart-rows'
import { ScheduleSection } from '@/web/ui/settings/schedule-section'

import '@/web/ui/dialogs/dialogs.css'
import './settings.css'

const SECTION_TITLES = Object.freeze({
  profile: 'ui.office.common.profile',
  schedule: 'ui.office.settings.schedule',
  agents: 'ui.office.settings.agents',
  channels: 'ui.office.settings.channels',
  data: 'ui.office.settings.data',
  display: 'ui.office.settings.display',
  advanced: 'ui.office.settings.advanced',
} as const satisfies Record<SettingsSection, MessageKey>)

// The section last open, so the way back from a form lands where the operator left.
const chosen = signal<SettingsSection>('profile')

/** Opens Cài đặt on `section`, or on the one last open. */
export function openSettings(section?: SettingsSection): void {
  if (section !== undefined) {
    chosen.value = section
  }

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
            {tr(SECTION_TITLES[section])}
          </button>
        ))}
      </nav>
      <div class="settings-form">
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
    case 'schedule':
      return <ScheduleSection reopen={reopen} />
    case 'agents':
      return <AgentsSection />
    case 'channels':
      return <ChannelsSection />
    case 'data':
      return <DataSection />
    case 'display':
      return <DisplaySection />
    case 'advanced':
      return <AdvancedSection />
  }
}

// What waits for a restart, with the way to do it; with nothing pending, how saving works.
function SettingsFooter() {
  const rows = pendingRestart.value

  if (rows.length === 0) {
    return (
      <>
        <div class="dialog-foot-left">
          <span class="dialog-note">{tr('ui.office.settings.footNote')}</span>
        </div>
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
