import { computed, signal } from '@preact/signals'

import type { FeatureCapabilities } from '@/app/server/wire/system'
import type { MessageKey } from '@/i18n'
import { state } from '@/web/state/session'

// A page that is the web edition knows it before the worker has answered, so nothing of the
// daemon's shows in the moments a restart leaves the session unread.
const isWebPage = signal(false)

/** The web edition's entry says so once, before it renders. */
export function declareWebEdition(): void {
  isWebPage.value = true
}

/** The edition serving this page gives analysis only (the browser edition): no verdict, level or
 *  order, and the parts of the daemon that need a host (restarts, updates) are not
 *  there. It reads the session's capability, and the page's own word while there is no session. */
export const isAnalysisOnly = computed(
  () => state.value?.capabilities.analysisOnly ?? isWebPage.value
)

/** Whether the edition offers `feature`. A page hides what an edition does not offer rather than
 *  offering it and failing; before the session loads the web page offers nothing it may lack. */
export function offers(feature: keyof FeatureCapabilities): boolean {
  return state.value?.capabilities[feature] ?? !isWebPage.value
}

/** The key an edition words a line with: the web's own wording where the daemon's would name a
 *  stop, a size or a service the web edition does not have. */
export function editionKey(daemon: MessageKey, web: MessageKey): MessageKey {
  return isAnalysisOnly.value ? web : daemon
}

/** The screen's name: the daemon's board of opportunities, the web's screen of readings, which names
 *  no name a chance. */
export function screenTabKey(): MessageKey {
  return editionKey('ui.office.ideas.screen', 'ui.office.edition.screen.title')
}

/** The name of the panel's third tab: the daemon's calls, the web's analyses. Every place that names
 *  the tab (the tab bar, its sub-tabs, the back row, the shortcut list) reads it here. */
export function ideasTabKey(): MessageKey {
  return editionKey('ui.office.panel.ideas', 'ui.office.edition.analysis.tab')
}
