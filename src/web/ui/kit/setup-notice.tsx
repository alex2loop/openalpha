import type { ComponentChildren } from 'preact'

import { InfoIcon, WarningIcon } from '@/web/ui/kit/icons'

import './setup-notice.css'

/** caution: something the operator sets up before a feature works. info: a keyless fallback that
 *  already covers it. */
export type SetupNoticeTone = 'caution' | 'info'

interface SetupNoticeProps {
  readonly tone: SetupNoticeTone
  readonly title: string
  readonly children?: ComponentChildren
}

/** A setup notice: a signal icon and a short title, then compact rows the caller lays out. */
export function SetupNotice({ tone, title, children }: SetupNoticeProps) {
  const Icon = tone === 'caution' ? WarningIcon : InfoIcon

  return (
    <section class={`setup-notice is-${tone}`} role="status">
      <h3 class="setup-notice-head">
        <Icon />
        <span>{title}</span>
      </h3>
      {children}
    </section>
  )
}

/** One row: what it is, then a muted line beside it that wraps under it on a narrow panel. */
export function SetupNoticeRow({
  name,
  children,
}: {
  readonly name: string
  readonly children?: ComponentChildren
}) {
  return (
    <div class="setup-notice-row">
      <span class="setup-notice-name">{name}</span>
      {children}
    </div>
  )
}
