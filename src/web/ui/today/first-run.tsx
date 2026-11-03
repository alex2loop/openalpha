import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { BRIEF_COMMAND } from '@/web/state/command'
import { editionKey, isAnalysisOnly } from '@/web/state/edition'
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

/** "Bắt đầu với {brand}": five steps (four on the web) for a daemon with no model, no profile and an
 *  empty book. */
export function FirstRun() {
  const firstRun = state.value?.firstRun
  const steps: ((index: number) => ComponentChildren)[] = [
    (index) => <ModelStep key="model" index={index} isDone={isModelReady.value} />,
    (index) => <ProfileStep key="profile" index={index} isDone={firstRun?.profileSaved === true} />,
    (index) => <BookStep key="book" index={index} isDone={firstRun?.bookEmpty === false} />,
    ...(isAnalysisOnly.value ? [] : [(index: number) => <ChatStep key="chat" index={index} />]),
    (index) => <BriefStep key="brief" index={index} />,
  ]

  return (
    <section class="block">
      <h2 class="block-head">{tr('ui.office.firstRun.title')}</h2>
      <div class="steps">{steps.map((renderStep, position) => renderStep(position + 1))}</div>
    </section>
  )
}

function ProfileStep({ index, isDone }: NumberedStep & { readonly isDone: boolean }) {
  return (
    <Step index={index} title={tr('ui.office.common.profile')} isDone={isDone}>
      <p class="meta">
        {tr(editionKey('ui.office.firstRun.profileBody', 'ui.office.edition.firstRun.profileBody'))}
      </p>
      <div class="step-actions">
        <Button size="small" onClick={() => openSettings('profile')}>
          {tr('ui.office.firstRun.profileCta')}
        </Button>
      </div>
    </Step>
  )
}

// The book can also be left empty on purpose: "Chưa có, bỏ qua" counts the step as done.
function BookStep({ index, isDone }: NumberedStep & { readonly isDone: boolean }) {
  const isSkipped = useSignal(false)

  return (
    <Step
      index={index}
      title={tr('ui.office.firstRun.bookTitle')}
      isDone={isDone || isSkipped.value}
    >
      <p class="meta">
        {tr(editionKey('ui.office.firstRun.bookBody', 'ui.office.edition.firstRun.bookBody'))}
      </p>
      <div class="step-actions">
        <Button size="small" onClick={() => openTradeDialog()}>
          {tr('ui.office.common.recordTrade')}
        </Button>
        <Button
          size="small"
          onClick={() => {
            isSkipped.value = true
          }}
        >
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

// The key itself is never typed here: the page only names the variable the daemon reads.
function ModelStep({ index, isDone }: NumberedStep & { readonly isDone: boolean }) {
  const recheck = useRecheck()
  const envVar = state.value?.firstRun.modelKeyEnv

  if (isAnalysisOnly.value) {
    return <WebModelStep index={index} isDone={isDone} />
  }

  return (
    <Step index={index} title={tr('ui.office.firstRun.modelTitle')} isDone={isDone}>
      {!isDone && (
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
      )}
    </Step>
  )
}

// The web edition runs the market, the screen and the ledger with no key at all; a key of the
// visitor's own unlocks the AI parts.
function WebModelStep({ index, isDone }: NumberedStep & { readonly isDone: boolean }) {
  return (
    <Step
      index={index}
      title={tr('ui.office.edition.firstRun.keyTitle')}
      isDone={isDone}
      isOptional
    >
      {!isDone && (
        <>
          <p class="meta">{tr('ui.office.edition.firstRun.keyBody')}</p>
          <div class="step-actions">
            <Button size="small" onClick={() => openSettings('providers')}>
              {tr('ui.office.edition.firstRun.keyCta')}
            </Button>
          </div>
        </>
      )}
    </Step>
  )
}

// The daemon's brief waits for a model to answer it; the web edition's reads the market and needs
// no key.
function BriefStep({ index }: NumberedStep) {
  return (
    <Step index={index} title={tr('ui.office.firstRun.briefTitle')} isDone={false}>
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
