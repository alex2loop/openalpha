import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { BRIEF_COMMAND, runCommand } from '@/web/state/command'
import { loadSession, state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'
import { CheckIcon } from '@/web/ui/kit/icons'
import { openSettings } from '@/web/ui/settings/settings'

interface StepProps {
  readonly index: number
  readonly title: string
  readonly isDone: boolean
  readonly isOptional?: boolean
  readonly children: ComponentChildren
}

/** "Bắt đầu với {brand}": five steps for a daemon with no model, no profile and an empty book. */
export function FirstRun() {
  const firstRun = state.value?.firstRun

  return (
    <section class="block">
      <h2 class="block-head">{tr('ui.office.firstRun.title')}</h2>
      <div class="steps">
        <ModelStep isDone={firstRun?.modelReady === true} />
        <ProfileStep isDone={firstRun?.profileSaved === true} />
        <BookStep isDone={firstRun?.bookEmpty === false} />
        <ChatStep />
        <BriefStep isModelReady={firstRun?.modelReady === true} />
      </div>
    </section>
  )
}

function ProfileStep({ isDone }: { readonly isDone: boolean }) {
  return (
    <Step index={2} title={tr('ui.office.common.profile')} isDone={isDone}>
      <p class="meta">{tr('ui.office.firstRun.profileBody')}</p>
      <div class="step-actions">
        <Button size="small" onClick={() => openSettings('profile')}>
          {tr('ui.office.firstRun.profileCta')}
        </Button>
      </div>
    </Step>
  )
}

// The book can also be left empty on purpose: "Chưa có, bỏ qua" counts the step as done.
function BookStep({ isDone }: { readonly isDone: boolean }) {
  const isSkipped = useSignal(false)

  return (
    <Step index={3} title={tr('ui.office.firstRun.bookTitle')} isDone={isDone || isSkipped.value}>
      <p class="meta">{tr('ui.office.firstRun.bookBody')}</p>
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

function ChatStep() {
  return (
    <Step index={4} title={tr('ui.office.firstRun.chatTitle')} isDone={false} isOptional>
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
function ModelStep({ isDone }: { readonly isDone: boolean }) {
  const recheck = useRecheck()
  const envVar = state.value?.firstRun.modelKeyEnv

  return (
    <Step index={1} title={tr('ui.office.firstRun.modelTitle')} isDone={isDone}>
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

// The brief runs at once; it waits for a model to answer it.
function BriefStep({ isModelReady }: { readonly isModelReady: boolean }) {
  return (
    <Step index={5} title={tr('ui.office.firstRun.briefTitle')} isDone={false}>
      <p class="meta">{tr('ui.office.firstRun.briefBody')}</p>
      <div class="step-actions">
        <Button size="small" disabled={!isModelReady} onClick={() => runCommand(BRIEF_COMMAND)}>
          {tr('ui.office.firstRun.briefCta')}
        </Button>
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
