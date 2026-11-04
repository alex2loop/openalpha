import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'

import { BRIEF_NAME } from '@/web/state/command'
import { isAnalysisOnly } from '@/web/state/edition'
import { onCommandFinished } from '@/web/state/events'
import { isFirstRun, isModelReady, state } from '@/web/state/session'
import { readStorage, writeStorage } from '@/web/state/storage'

const PROFILE_KEPT_KEY = 'office.firstRun.profileKept'
const BOOK_SKIPPED_KEY = 'office.firstRun.bookSkipped'
const BRIEF_RAN_KEY = 'office.firstRun.briefRan'
const HIDDEN_KEY = 'office.firstRun.hidden'
const STARTED_KEY = 'office.firstRun.started'
const STORED = '1'
const COMPLETED = 'completed'

// Each answer is this viewer's alone, so it lives in the browser; where storage is blocked it holds
// for the session.
const profileKept = signal(isStored(PROFILE_KEPT_KEY))
const bookSkipped = signal(isStored(BOOK_SKIPPED_KEY))
const briefRan = signal(isStored(BRIEF_RAN_KEY))
const hidden = signal(isStored(HIDDEN_KEY))
// Set the first time this browser sees a first run, so a daemon set up long before never shows the
// checklist, while one set up here keeps it until its steps are done.
const started = signal(isStored(STARTED_KEY))

/** A profile was saved, or the visitor chose to keep the defaults the daemon starts on. */
export const isProfileDone = computed(
  () => state.value?.firstRun.profileSaved === true || profileKept.value
)
/** The ledger holds a row, or the visitor said there is nothing to record yet. */
export const isBookDone = computed(
  () => state.value?.firstRun.bookEmpty === false || bookSkipped.value
)
/** A `/brief` run finished in this browser. */
export const isBriefDone: ReadonlySignal<boolean> = briefRan

// The model key is optional on the web edition, which runs without one; the chat step is optional
// everywhere.
const areRequiredStepsDone = computed(
  () =>
    (isAnalysisOnly.value || isModelReady.value) &&
    isProfileDone.value &&
    isBookDone.value &&
    briefRan.value
)

/** The checklist shows from a first run until every required step is done or the visitor hides
 *  it. */
export const isGuideShown = computed(
  () =>
    state.value !== undefined &&
    (started.value || isFirstRun.value) &&
    !hidden.value &&
    !areRequiredStepsDone.value
)

/** Notes a first run once it is seen, and watches for a `/brief` run that completes; the returned
 *  function stops both. */
export function startFirstRun(): () => void {
  const stopStart = effect(() => {
    if (isFirstRun.value && !started.peek()) {
      started.value = true
      writeStorage('local', STARTED_KEY, STORED)
    }
  })
  const stopBrief = onCommandFinished(BRIEF_NAME, (outcome) => {
    if (outcome === COMPLETED) {
      briefRan.value = true
      writeStorage('local', BRIEF_RAN_KEY, STORED)
    }
  })

  return () => {
    stopStart()
    stopBrief()
  }
}

export function keepProfileDefaults(): void {
  profileKept.value = true
  writeStorage('local', PROFILE_KEPT_KEY, STORED)
}

export function skipBook(): void {
  bookSkipped.value = true
  writeStorage('local', BOOK_SKIPPED_KEY, STORED)
}

export function hideGuide(): void {
  hidden.value = true
  writeStorage('local', HIDDEN_KEY, STORED)
}

function isStored(key: string): boolean {
  return readStorage('local', key) === STORED
}
