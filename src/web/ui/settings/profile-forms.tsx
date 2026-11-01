import type { TradingProfileResponse } from '@/app/server/wire/trading'
import type { InvestmentGoal, InvestmentHorizon, RiskLevel } from '@/app/server/wire/vocab'
import { pluralKey } from '@/i18n'
import { readBlock } from '@/web/state/block'
import { profileBlock } from '@/web/state/market'
import { isSegmentOn, saveProfilePatch } from '@/web/state/profile'
import { segmentName } from '@/web/text/segment'
import { toFailureText, tr } from '@/web/text/tr'
import { openTargetsDialog } from '@/web/ui/dialogs/targets-dialog'
import { Button } from '@/web/ui/kit/button'
import { Segmented } from '@/web/ui/kit/segmented'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { ActionRow, type SectionProps, SettingRow, useDraft } from '@/web/ui/settings/row'

// Exhaustive by `satisfies`, in the order the page offers them.
// why-safe: the object's keys are exactly the union, checked by `satisfies`.
const RISK_LEVELS = Object.keys({
  conservative: true,
  balanced: true,
  aggressive: true,
} satisfies Record<RiskLevel, true>) as readonly RiskLevel[]
// why-safe: as above.
const GOALS = Object.keys({
  preserve: true,
  income: true,
  grow: true,
} satisfies Record<InvestmentGoal, true>) as readonly InvestmentGoal[]
// why-safe: as above.
const HORIZONS = Object.keys({
  short: true,
  long: true,
} satisfies Record<InvestmentHorizon, true>) as readonly InvestmentHorizon[]

/** Hồ sơ đầu tư: what the profile chooses sizes and stops from. Every row acts on the running
 *  daemon at once. */
export function ProfileSection({ reopen }: SectionProps) {
  const reading = readBlock(profileBlock)
  const { data } = reading

  if (data === undefined) {
    return reading.error === undefined ? (
      <Skeleton lines={3} />
    ) : (
      <p class="failure-line">{toFailureText(reading.error)}</p>
    )
  }

  return (
    <>
      <p class="meta">{tr('ui.office.settings.profileNote')}</p>
      <p class="meta">{tr('ui.office.memory.learned')}</p>
      <RiskRow profile={data} />
      <GoalRow profile={data} />
      <HorizonRow profile={data} />
      <SegmentsRow profile={data} reopen={reopen} />
    </>
  )
}

function RiskRow({ profile }: { readonly profile: TradingProfileResponse }) {
  const { draft, isChanged, markSaved } = useDraft(profile.riskLevel)

  return (
    <SettingRow
      title={tr('ui.office.settings.risk')}
      note={tr('ui.office.settings.riskNote')}
      timing="now"
      isChanged={isChanged}
      onSave={async () => {
        await saveProfilePatch({ riskLevel: draft.value })
        markSaved()
      }}
    >
      <Segmented
        label={tr('ui.office.settings.risk')}
        value={draft.value}
        options={RISK_LEVELS.map((value) => ({ value, label: tr(`trading.risk.${value}`) }))}
        onChange={(value) => {
          draft.value = value
        }}
      />
    </SettingRow>
  )
}

function GoalRow({ profile }: { readonly profile: TradingProfileResponse }) {
  const { draft, isChanged, markSaved } = useDraft(profile.goal)
  const title = tr('trading.render.profile.field.goal')

  return (
    <SettingRow
      title={title}
      note={tr('ui.office.settings.goalNote')}
      timing="now"
      isChanged={isChanged}
      onSave={async () => {
        await saveProfilePatch({ goal: draft.value })
        markSaved()
      }}
    >
      <Segmented
        label={title}
        value={draft.value}
        options={GOALS.map((value) => ({ value, label: tr(`trading.goal.${value}`) }))}
        onChange={(value) => {
          draft.value = value
        }}
      />
    </SettingRow>
  )
}

// A segment switched off has no horizon to choose.
function HorizonRow({ profile }: { readonly profile: TradingProfileResponse }) {
  const { draft, isChanged, markSaved } = useDraft(profile.horizons)
  const segments = Object.entries(draft.value).filter(([segment]) => isSegmentOn(profile, segment))

  return (
    <SettingRow
      title={tr('ui.office.common.horizon')}
      note={tr('ui.office.settings.horizonNote')}
      timing="now"
      isChanged={isChanged}
      onSave={async () => {
        await saveProfilePatch({ horizons: draft.value })
        markSaved()
      }}
    >
      {segments.map(([segment, horizon]) => (
        <div key={segment} class="setting-pair">
          <span>{segmentName(segment)}</span>
          <Segmented
            label={segmentName(segment)}
            value={horizon}
            options={HORIZONS.map((value) => ({ value, label: tr(`trading.horizon.${value}`) }))}
            onChange={(value) => {
              draft.value = { ...draft.value, [segment]: value }
            }}
          />
        </div>
      ))}
    </SettingRow>
  )
}

function SegmentsRow({
  profile,
  reopen,
}: SectionProps & { readonly profile: TradingProfileResponse }) {
  const count = Object.keys(profile.caps).filter((segment) => isSegmentOn(profile, segment)).length

  return (
    <ActionRow
      title={tr('ui.office.settings.segments')}
      summary={tr(
        pluralKey(count, 'ui.office.settings.segmentsCountOne', 'ui.office.settings.segmentsCount'),
        { count }
      )}
    >
      <Button size="small" onClick={() => openTargetsDialog(profile, { onBack: reopen })}>
        {tr('ui.office.common.edit')}
      </Button>
    </ActionRow>
  )
}
