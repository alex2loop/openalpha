import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'

import { BRIEF_NAME } from '@/web/state/command'
import { isAnalysisOnly } from '@/web/state/edition'
import { onCommandFinished } from '@/web/state/events'
import { isFirstRun, isModelReady, state } from '@/web/state/session'
import { createStoredFlag } from '@/web/state/storage'

const PROFILE_KEPT_KEY = 'office.firstRun.profileKept'
const MODEL_CHOSEN_KEY = 'office.firstRun.modelChosen'
const BOOK_SKIPPED_KEY = 'office.firstRun.bookSkipped'
const BRIEF_RAN_KEY = 'office.firstRun.briefRan'
const HIDDEN_KEY = 'office.firstRun.hidden'
const STARTED_KEY = 'office.firstRun.started'
const COMPLETED = 'completed'

// Each answer is this viewer's alone, so it lives in the browser; where storage is blocked it holds
// for the session.
const profileKept = createStoredFlag(PROFILE_KEPT_KEY)
const modelChosen = createStoredFlag(MODEL_CHOSEN_KEY)
const bookSkipped = createStoredFlag(BOOK_SKIPPED_KEY)
const briefRan = createStoredFlag(BRIEF_RAN_KEY)
// Set by the visitor, or when the required steps were first all done, so a key removed or a ledger
// emptied later does not bring the checklist back.
const hidden = createStoredFlag(HIDDEN_KEY)
// Set the first time this browser sees a first run, so a daemon set up long before never shows the
// checklist, while one set up here keeps it until its steps are done.
const started = createStoredFlag(STARTED_KEY)
// Opened again from Hôm nay after the first run: for this page's life only, and never a reason to
// hold back what a first run holds back.
const reviewing = signal(false)

/** A profile was saved, or the visitor chose to keep the defaults the daemon starts on. */
export const isProfileDone = computed(
  () => state.value?.firstRun.profileSaved === true || profileKept.flag.value
)
/** The visitor saved a model, or chose to keep the one the page starts on. */
export const isModelChosen: ReadonlySignal<boolean> = modelChosen.flag
/** The ledger holds a row, or the visitor said there is nothing to record yet. */
export const isBookDone = computed(
  () => state.value?.firstRun.bookEmpty === false || bookSkipped.flag.value
)
/** A `/brief` run finished in this browser. */
export const isBriefDone: ReadonlySignal<boolean> = briefRan.flag

// The model key is optional on the web edition, which runs without one; the chat step is optional
// everywhere.
const areRequiredStepsDone = computed(
  () =>
    (isAnalysisOnly.value || isModelReady.value) &&
    isProfileDone.value &&
    isBookDone.value &&
    isBriefDone.value
)

// The checklist's own run: from a first run until every required step is done or the visitor hides
// it.
const isFirstRunOpen = computed(
  () =>
    state.value !== undefined &&
    (started.flag.value || isFirstRun.value) &&
    !hidden.flag.value &&
    !areRequiredStepsDone.value
)

/** The checklist shows while the first run is open, or while the visitor reads it again. */
export const isGuideShown = computed(
  () => state.value !== undefined && (isFirstRunOpen.value || reviewing.value)
)

/** The first run is over: it finished, was hidden, or never applied to this daemon. What a first
 *  run holds back (the cost chip, the tape's notes) reads this; reading the checklist again does not
 *  reopen it. */
export const isFirstRunOver = computed(() => !isFirstRunOpen.value)

/** True while the checklist shows only because the visitor opened it again. */
export const isGuideReviewed: ReadonlySignal<boolean> = reviewing

/** Notes a first run once it is seen, latches the guide done when its required steps first are, and
 *  watches for a `/brief` run that completes; the returned function stops all three. */
export function startFirstRun(): () => void {
  const stopStart = effect(() => {
    if (isFirstRun.value && !started.flag.peek()) {
      started.set()
    }
  })
  const stopLatch = effect(() => {
    if (areRequiredStepsDone.value && !hidden.flag.peek()) {
      hideGuide()
    }
  })
  const stopBrief = onCommandFinished(BRIEF_NAME, (outcome) => {
    if (outcome === COMPLETED) {
      briefRan.set()
    }
  })

  return () => {
    stopStart()
    stopLatch()
    stopBrief()
  }
}

export function keepProfileDefaults(): void {
  profileKept.set()
}

export function markModelChosen(): void {
  modelChosen.set()
}

export function skipBook(): void {
  bookSkipped.set()
}

export function hideGuide(): void {
  reviewing.value = false
  hidden.set()
}

export function showGuideAgain(): void {
  reviewing.value = true
}
