import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

import { BRIEF_COMMAND } from '@/web/state/command'
import { editionKey, isAnalysisOnly } from '@/web/state/edition'
import {
  hideGuide,
  isBookDone,
  isBriefDone,
  isGuideReviewed,
  isProfileDone,
  keepProfileDefaults,
  showGuideAgain,
  skipBook,
} from '@/web/state/first-run'
import { isModelReady, loadSession, state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { RunButton } from '@/web/ui/command/run-button'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'
import { CheckIcon } from '@/web/ui/kit/icons'
import { openSettings } from '@/web/ui/settings/settings'

interface NumberedStep {
  readonly index: number
}

interface StepProps {
  readonly index: number
  readonly title: string
  readonly isDone: boolean
  readonly isOptional?: boolean
  readonly children: ComponentChildren
}

/** "Bắt đầu với {brand}": five steps (four on the web) above the day's blocks, until every
 *  required one is done or the visitor hides it. */
export function FirstRun() {
  const steps: ((index: number) => ComponentChildren)[] = [
    (index) => <ModelStep key="model" index={index} isDone={isModelReady.value} />,
    (index) => <ProfileStep key="profile" index={index} />,
    (index) => <BookStep key="book" index={index} />,
    ...(isAnalysisOnly.value ? [] : [(index: number) => <ChatStep key="chat" index={index} />]),
    (index) => <BriefStep key="brief" index={index} />,
  ]

  const section = useRef<HTMLElement>(null)

  // Opened again from the foot of the tab: bring it into view, since it renders at the top.
  useEffect(() => {
    if (isGuideReviewed.peek()) {
      section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [])

  return (
    <section ref={section} class="block">
      <h2 class="block-head">
        {tr('ui.office.firstRun.title')}
        <span class="block-grow" />
        <Button kind="ghost" size="small" onClick={hideGuide}>
          {tr('ui.office.firstRun.hide')}
        </Button>
      </h2>
      <div class="steps">{steps.map((renderStep, position) => renderStep(position + 1))}</div>
    </section>
  )
}

/** Past the first run, the foot of Hôm nay offers the checklist again. */
export function GuideAgain() {
  return (
    <div class="step-actions">
      <Button kind="ghost" size="small" onClick={showGuideAgain}>
        {tr('ui.office.firstRun.show')}
      </Button>
    </div>
  )
}

// A daemon that never saved a profile runs on seeded defaults, so the step says so and lets the
// visitor keep them.
function ProfileStep({ index }: NumberedStep) {
  return (
    <Step index={index} title={tr('ui.office.common.profile')} isDone={isProfileDone.value}>
      <p class="meta">
        {tr(editionKey('ui.office.firstRun.profileBody', 'ui.office.edition.firstRun.profileBody'))}
      </p>
      <p class="meta">{tr('ui.office.firstRun.profileDefaults')}</p>
      <div class="step-actions">
        <Button size="small" onClick={() => openSettings('profile')}>
          {tr('ui.office.firstRun.profileCta')}
        </Button>
        <Button size="small" onClick={keepProfileDefaults}>
          {tr('ui.office.firstRun.profileKeep')}
        </Button>
      </div>
    </Step>
  )
}

// The book can also be left empty on purpose: "Chưa có, bỏ qua" counts the step as done.
function BookStep({ index }: NumberedStep) {
  return (
    <Step index={index} title={tr('ui.office.firstRun.bookTitle')} isDone={isBookDone.value}>
      <p class="meta">
        {tr(editionKey('ui.office.firstRun.bookBody', 'ui.office.edition.firstRun.bookBody'))}
      </p>
      <div class="step-actions">
        <Button size="small" onClick={() => openTradeDialog()}>
          {tr('ui.office.common.recordTrade')}
        </Button>
        <Button size="small" onClick={skipBook}>
          {tr('ui.office.firstRun.bookSkip')}
        </Button>
      </div>
    </Step>
  )
}

function ChatStep({ index }: NumberedStep) {
  return (
    <Step index={index} title={tr('ui.office.firstRun.chatTitle')} isDone={false} isOptional>
      <p class="meta">{tr('ui.office.firstRun.chatBody')}</p>
      <div class="step-actions">
        <Button size="small" onClick={() => openSettings('channels')}>
          {tr('ui.office.firstRun.chatCta')}
        </Button>
      </div>
    </Step>
  )
}

function Step({ index, title, isDone, isOptional, children }: StepProps) {
  return (
    <div class={isDone ? 'step is-done' : 'step'}>
      <span class="step-num">{isDone ? <CheckIcon /> : index}</span>
      <div class="step-main">
        <b>
          {title}
          {isOptional === true && (
            <span class="step-optional">{tr('ui.office.firstRun.optional')}</span>
          )}
        </b>
        {children}
      </div>
    </div>
  )
}

function ModelStep({ index, isDone }: NumberedStep & { readonly isDone: boolean }) {
  return (
    <Step index={index} title={modelTitle()} isDone={isDone} isOptional={isAnalysisOnly.value}>
      {!isDone && <ModelSetup />}
    </Step>
  )
}

/** The model step's title: a key of the visitor's own on the web edition, a model the daemon can
 *  reach on the installed version. */
export function modelTitle(): string {
  return tr(editionKey('ui.office.firstRun.modelTitle', 'ui.office.edition.firstRun.keyTitle'))
}

/** What to do while no model can answer: on the web edition, add a key of the visitor's own (the
 *  market, the screen and the ledger run without one); on the installed version, the variable the
 *  daemon reads, and a recheck. The key itself is never typed here on the installed version. */
export function ModelSetup() {
  const recheck = useRecheck()
  const envVar = state.value?.firstRun.modelKeyEnv

  if (isAnalysisOnly.value) {
    return (
      <>
        <p class="meta">{tr('ui.office.edition.firstRun.keyBody')}</p>
        <div class="step-actions">
          <Button size="small" onClick={() => openSettings('providers')}>
            {tr('ui.office.edition.firstRun.keyCta')}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <p class="meta">
        {envVar === undefined
          ? tr('ui.office.firstRun.modelBodyNoKey')
          : tr('ui.office.firstRun.modelBody', { envVar })}
      </p>
      <div class="step-actions">
        <Button size="small" onClick={recheck}>
          {tr('ui.office.common.recheck')}
        </Button>
      </div>
    </>
  )
}

// The daemon's brief waits for a model to answer it; the web edition's reads the market and needs
// no key.
function BriefStep({ index }: NumberedStep) {
  return (
    <Step index={index} title={tr('ui.office.firstRun.briefTitle')} isDone={isBriefDone.value}>
      <p class="meta">
        {tr(editionKey('ui.office.firstRun.briefBody', 'ui.office.edition.firstRun.briefBody'))}
      </p>
      <div class="step-actions">
        <RunButton
          command={BRIEF_COMMAND}
          label={tr('ui.office.firstRun.briefCta')}
          size="small"
          disabled={!(isAnalysisOnly.value || isModelReady.value)}
        />
      </div>
    </Step>
  )
}

// Reads the session again, which is where the daemon reports a key it can now see.
function useRecheck(): () => void {
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => running.current?.abort(), [])

  return () => {
    running.current?.abort()
    running.current = new AbortController()
    // `loadSession` records its own failure, so it never rejects.
    loadSession(running.current.signal).catch(() => undefined)
  }
}
