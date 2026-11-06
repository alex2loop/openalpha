import { breakpoint } from '@/web/state/breakpoints'
import { tr } from '@/web/text/tr'

const BRIEF_URL_META = 'meta[name="brief-url"]'

/** The morning-brief app's address, stamped into the page at build time; absent while the app is
 *  invite only. */
const briefUrl = document.querySelector<HTMLMetaElement>(BRIEF_URL_META)?.content

/** One line that points a phone reader to the morning-brief app. It shows only on the phone layout
 *  and only when the build stamped an address. */
export function PhoneBriefLine() {
  if (briefUrl === undefined || breakpoint.value !== 'phone') {
    return null
  }

  return (
    <p class="meta phone-brief-line">
      <a href={briefUrl} target="_blank" rel="noopener noreferrer">
        {tr('ui.office.edition.phoneBrief')}
      </a>
    </p>
  )
}
