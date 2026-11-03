import { signal } from '@preact/signals'

import { openPrivacy } from '@/web/edition/legal/privacy'
import { readStorage, writeStorage } from '@/web/state/storage'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'

import './guide.css'

const SEEN_STORAGE_KEY = 'oa.edition.firstRunSeen'
const STEPS = Object.freeze(['nokey', 'key', 'save'] as const)
const KEY_STEP = STEPS.indexOf('key')

const step = signal(0)

/** Opens the introduction the first time a visitor reaches the loaded page, and never again on its
 *  own: the guide reopens it. */
export function openFirstRunOnce(): void {
  if (readStorage('local', SEEN_STORAGE_KEY) !== undefined) {
    return
  }

  writeStorage('local', SEEN_STORAGE_KEY, '1')
  openFirstRun()
}

/** Three cards: what works with no key, adding an AI key (after the privacy page), saving data to
 *  a file. `from` opens it on one of them, which is where the privacy page returns to. */
export function openFirstRun(from = 0): void {
  step.value = from

  openModal({
    title: tr('ui.office.edition.guide.first.title'),
    body: <Card />,
    footer: <Footer />,
  })
}

function Card() {
  switch (STEPS[step.value]) {
    case 'nokey':
      return (
        <>
          <h3>{tr('ui.office.edition.guide.first.nokey.title')}</h3>
          <p>{tr('ui.office.edition.guide.first.nokey.body')}</p>
        </>
      )
    case 'key':
      return (
        <>
          <h3>{tr('ui.office.edition.guide.first.key.title')}</h3>
          <p>{tr('ui.office.edition.guide.first.key.body')}</p>
          <Button
            kind="tertiary"
            onClick={() => openPrivacy({ back: () => openFirstRun(KEY_STEP) })}
          >
            {tr('ui.office.edition.guide.first.key.privacy')}
          </Button>
        </>
      )
    default:
      return (
        <>
          <h3>{tr('ui.office.edition.guide.first.save.title')}</h3>
          <p>
            {tr(
              'showSaveFilePicker' in window
                ? 'ui.office.edition.guide.first.save.body'
                : 'ui.office.edition.guide.first.save.bodyManual'
            )}
          </p>
        </>
      )
  }
}

function Footer() {
  const isLast = step.value === STEPS.length - 1

  return (
    <>
      <span class="meta">
        {tr('ui.office.edition.guide.first.step', { current: step.value + 1, total: STEPS.length })}
      </span>
      {step.value > 0 && (
        <Button onClick={() => step.value--}>{tr('ui.office.edition.guide.first.back')}</Button>
      )}
      {!isLast && <Button onClick={closeModal}>{tr('ui.office.edition.guide.first.skip')}</Button>}
      <Button kind="commit" onClick={isLast ? closeModal : () => step.value++}>
        {tr(isLast ? 'ui.office.edition.guide.first.done' : 'ui.office.edition.guide.first.next')}
      </Button>
    </>
  )
}
