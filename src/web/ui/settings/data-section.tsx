import type { SettingsSection } from '@/web/state/settings'
import { DataHealth } from '@/web/ui/settings/data-health'
import { Outbound } from '@/web/ui/settings/outbound'

/** Dữ liệu và kết nối: how healthy the daemon and its sources are, and every host it can call. */
export function DataSection({
  openSection,
}: {
  readonly openSection: (section: SettingsSection) => void
}) {
  return (
    <>
      <DataHealth openSection={openSection} />
      <Outbound />
    </>
  )
}
