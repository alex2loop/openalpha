import type { ComponentChildren } from 'preact'

import type { SourcesResponse } from '@/app/server/wire/market'
import type { DoctorCheck, DoctorCheckId, DoctorReport } from '@/app/server/wire/system'
import type { MessageKey } from '@/i18n'
import { pluralKey } from '@/i18n'
import { isAdvanced } from '@/web/state/prefs'
import { brand } from '@/web/state/session'
import { SECTION_TITLES, type SettingsSection } from '@/web/state/settings'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

type Source = SourcesResponse['sources'][number]
type Status = DoctorCheck['status']
type Level = 'ok' | 'warn' | 'bad'

interface Pill {
  readonly level: Level
  readonly label: MessageKey
}

/** Problems first, then what is optional, then what only the terminal can check. */
const STATUS_ORDER: readonly Status[] = ['fail', 'warn', 'info', 'cliOnly', 'ok']
const PILLS = Object.freeze({
  ok: { level: 'ok', label: 'ui.office.common.ok' },
  info: { level: 'ok', label: 'ui.office.doctor.optional' },
  warn: { level: 'warn', label: 'ui.office.data.warn' },
  fail: { level: 'bad', label: 'ui.office.data.bad' },
} as const satisfies Record<Exclude<Status, 'cliOnly'>, Pill>)
const SOURCE_PILL: Pill = PILLS.warn
const FIX_KEYS: Partial<Record<DoctorCheckId, MessageKey>> = Object.freeze({
  models: 'ui.office.doctor.fix.models',
  'data-dir': 'ui.office.doctor.fix.data-dir',
  logging: 'ui.office.doctor.fix.logging',
  database: 'ui.office.doctor.fix.database',
  channels: 'ui.office.doctor.fix.channels',
  delivery: 'ui.office.doctor.fix.delivery',
  sources: 'ui.office.doctor.fix.sources',
  safety: 'ui.office.doctor.fix.safety',
  venues: 'ui.office.doctor.fix.venues',
  'web-search': 'ui.office.doctor.fix.web-search',
  providers: 'ui.office.doctor.fix.providers',
  telegram: 'ui.office.doctor.fix.telegram',
  zalo: 'ui.office.doctor.fix.zalo',
  version: 'ui.office.doctor.fix.version',
  api: 'ui.office.doctor.fix.api',
})

/** Where the page itself can fix a check; a bot token is set on the server, so it has none. */
const DOCTOR_FIX_SECTION: Partial<Record<DoctorCheckId, SettingsSection>> = Object.freeze({
  models: 'data',
  providers: 'data',
  venues: 'data',
  sources: 'data',
  'web-search': 'data',
  delivery: 'advanced',
  channels: 'channels',
})

interface DoctorRowsProps {
  readonly report: DoctorReport
  readonly troubled: readonly Source[]
  readonly openSection: (section: SettingsSection) => void
}

/** The head line, then each check as the daemon worded it, problems first. */
export function DoctorRows({ report, troubled, openSection }: DoctorRowsProps) {
  const rows = [...report.checks].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  )

  return (
    <>
      <HeadLine checks={report.checks} />
      <div class="row-list">
        {rows.map((check, index) => (
          <CheckRow key={`${check.check}:${index}`} check={check} openSection={openSection} />
        ))}
        {troubled.map((source) => (
          <RowFrame key={source.id} title={source.id} pill={SOURCE_PILL}>
            {source.failure !== undefined && <p class="meta">{source.failure}</p>}
          </RowFrame>
        ))}
      </div>
    </>
  )
}

function isProblem(check: DoctorCheck): boolean {
  return check.status === 'fail' || check.status === 'warn'
}

function HeadLine({ checks }: { readonly checks: readonly DoctorCheck[] }) {
  const count = checks.filter(isProblem).length

  if (count === 0) {
    return <p class="meta">{tr('cli.doctorNoProblems')}</p>
  }

  return (
    <p class="meta">
      {tr(pluralKey(count, 'cli.doctorProblemsFoundOne', 'cli.doctorProblemsFound'), { count })}{' '}
      {tr('ui.office.doctor.stillRuns')}
    </p>
  )
}

function CheckRow({
  check,
  openSection,
}: {
  readonly check: DoctorCheck
  readonly openSection: (section: SettingsSection) => void
}) {
  if (check.status === 'cliOnly') {
    return (
      <RowFrame title={check.name}>
        <p class="meta">{tr('ui.office.doctor.cliOnly', commandBrand())}</p>
      </RowFrame>
    )
  }

  return (
    <RowFrame title={check.name} pill={PILLS[check.status]}>
      {isAdvanced.value && check.detail !== undefined && (
        <details class="meta">
          <summary>{tr('ui.office.doctor.details')}</summary>
          {check.detail}
        </details>
      )}
      {isProblem(check) && <FixLine check={check.check} openSection={openSection} />}
    </RowFrame>
  )
}

function FixLine({
  check,
  openSection,
}: {
  readonly check: DoctorCheckId
  readonly openSection: (section: SettingsSection) => void
}) {
  const key = FIX_KEYS[check]
  const section = DOCTOR_FIX_SECTION[check]

  if (key === undefined) {
    return null
  }

  return (
    <div class="setting-actions">
      <p class="meta">{tr(key, commandBrand())}</p>
      {section !== undefined && (
        <Button size="small" onClick={() => openSection(section)}>
          {tr('ui.office.doctor.open', { section: tr(SECTION_TITLES[section]) })}
        </Button>
      )}
    </div>
  )
}

function RowFrame({
  title,
  pill,
  children,
}: {
  readonly title: string
  readonly pill?: Pill
  readonly children: ComponentChildren
}) {
  return (
    <div class="setting-job">
      <div class="setting-actions">
        <b>{title}</b>
        {pill !== undefined && <span class={`level-pill is-${pill.level}`}>{tr(pill.label)}</span>}
      </div>
      {children}
    </div>
  )
}

// The fix lines name a command, which the product's binary spells in lower case.
function commandBrand(): Record<string, string> {
  return { brand: (brand.value ?? '').toLowerCase() }
}
