import type {
  HudPlan,
  LiveRunHud,
  LiveRunHudTool,
  ResearchMilestone,
} from '@/channels/delivery/format'
import type { Reply } from '@/channels/delivery/reply'
import type { ChannelSettings } from '@/channels/schema'
import type { ChannelAdapter } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import type { StreamEvent } from '@/core/stream-events'
import type { Locale } from '@/core/types/locale'
import type {
  ForegroundResearchInteraction,
  ResearchProgress,
  ReviewResearchPlan,
} from '@/engine/api'
import {
  chunkResearchMilestone,
  renderLiveRunHud,
  toResearchMilestone,
  toResearchQuestionSlot,
} from '@/channels/delivery/format'
import { selectRenderer } from '@/channels/delivery/outbound/chunked-send'
import {
  finishLiveRunTool,
  MAX_TRACKED_TOOLS,
  startLiveRunTool,
  updateLiveRunTool,
} from '@/channels/delivery/stream-tools'
import { MAX_RESEARCH_QUESTIONS_LIMIT } from '@/core/config/resolve'
import { formatErrForLog } from '@/core/security/credentials'
import { lruMap } from '@/core/utils/collections'

type ResearchMilestoneRoute = 'hud' | 'messages' | 'off'
type TurnMetric = Extract<StreamEvent, { readonly type: 'turn_metric' }>
type ResearchQuestionParams = Extract<
  ResearchProgress,
  { readonly key: 'progress.researchQuestion' }
>['params']

export interface ChunkStream {
  readonly researchInteraction: ForegroundResearchInteraction
  onChunk(event: StreamEvent): void
  /** The plan the run stated, for the answer that replaces this preview. */
  plan(): HudPlan | undefined
  /** Last turn's model and context fill, for the footer the answer carries. */
  metric(): TurnMetric | undefined
  /** Resolves once any in-flight edit has landed, so the final write cannot be overtaken by it. */
  settle(): Promise<void>
  /** Clears pending work and detaches abort handling. Safe to call twice. */
  stop(): void
}

interface ChunkStreamDeps {
  readonly reply: Reply
  readonly adapter: ChannelAdapter
  readonly settings: ChannelSettings
  readonly useMarkup: boolean
  readonly logger: Logger
  readonly signal: AbortSignal
  readonly locale: Locale
  /** Channel-owned deep-plan review: deep research never starts without an explicit decision. */
  readonly reviewPlan: ReviewResearchPlan
}

export function createChunkStream(deps: ChunkStreamDeps): ChunkStream {
  return new LiveRunStream(deps)
}

class LiveRunStream implements ChunkStream {
  private readonly startedAt = performance.now()
  private readonly tools = lruMap<string, LiveRunHudTool>(MAX_TRACKED_TOOLS)
  private readonly researchMilestones = new Map<string, ResearchMilestone>()
  private statedPlan: HudPlan | undefined
  private latestMetric: TurnMetric | undefined
  private readonly researchQuestions = new Map<string, ResearchQuestionParams>()
  private readonly milestoneRoute: ResearchMilestoneRoute
  private timer: ReturnType<typeof setTimeout> | null = null
  private queuedText: string | null = null
  private editTail: Promise<void> | null = null
  private accepting: boolean
  private stopped = false
  private researchDone = false
  private pendingMilestones: ResearchMilestone[] = []
  private readonly onAbort = (): void => this.stop()

  // Progress and finish are synchronous by contract; channel I/O drains through the one edit
  // tail. Plan review is the one awaited interaction: the run pauses until the chat decides.
  readonly researchInteraction: ForegroundResearchInteraction = {
    reportProgress: (message) => this.reportResearch(message),
    reviewPlan: (input) => this.deps.reviewPlan(input),
    finish: () => this.finishResearch(),
  }

  constructor(private readonly deps: ChunkStreamDeps) {
    this.accepting =
      deps.settings.midStreamUpdates && deps.adapter.capabilities.canEdit && !deps.signal.aborted
    this.milestoneRoute = resolveMilestoneRoute(deps)

    if (this.milestoneRoute !== 'off') {
      deps.signal.addEventListener('abort', this.onAbort, { once: true })
    }
  }

  // Kept whatever the HUD is doing: the footer needs it even where mid-stream edits are off.
  onChunk(event: StreamEvent): void {
    if (event.type === 'turn_metric') {
      this.latestMetric = event

      return
    }

    if (!(this.accepting && this.updateHud(event))) {
      return
    }

    this.scheduleEdit()
  }

  plan(): HudPlan | undefined {
    return this.statedPlan
  }

  metric(): TurnMetric | undefined {
    return this.latestMetric
  }

  async settle(): Promise<void> {
    this.finishResearch()
    this.clearCoalescer()

    if (this.accepting) {
      this.flush()
    }

    this.kickMilestoneDrain()
    const pending = this.editTail

    if (pending !== null) {
      await pending
    }

    this.stop()
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.accepting = false
    this.researchDone = true
    this.queuedText = null
    this.researchMilestones.clear()
    this.researchQuestions.clear()
    this.pendingMilestones = []
    this.clearCoalescer()
    this.deps.signal.removeEventListener('abort', this.onAbort)
  }

  private clearCoalescer(): void {
    if (this.timer === null) {
      return
    }
    clearTimeout(this.timer)
    this.timer = null
  }

  private scheduleEdit(): void {
    if (this.timer !== null) {
      return
    }
    this.timer = setTimeout(() => this.flush(), this.deps.settings.midStreamThrottleMs)
  }

  private flush(): void {
    this.timer = null

    if (!this.accepting) {
      return
    }

    // One message-worth only: the HUD is a live preview edited in place, and spilling its overflow
    // into new messages on every throttled flush would bury the chat. The delivered answer is whole.
    const [head] = this.renderHudChunks()

    if (head !== undefined) {
      this.enqueueLatest(head)
    }
  }

  private reportResearch(message: ResearchProgress): void {
    if (this.researchDone || this.milestoneRoute === 'off' || this.deps.signal.aborted) {
      return
    }

    if (message.key === 'progress.researchQuestion') {
      this.trackResearchQuestion(message.params)
    }

    // Running states churn until they settle, so they belong in the edited HUD and nowhere else.
    if (this.milestoneRoute !== 'hud' && isRunningProgress(message)) {
      return
    }

    const milestone = toResearchMilestone(message, this.deps.locale)

    if (milestone === undefined) {
      return
    }

    if (!this.setResearchMilestone(milestone)) {
      return
    }

    if (this.milestoneRoute === 'hud') {
      if (this.renderHudChunks().length > 1) {
        this.enqueueMilestone(milestone)
      }

      this.scheduleEdit()
      return
    }

    this.enqueueMilestone(milestone)
  }

  private trackResearchQuestion(params: ResearchQuestionParams): void {
    if (this.milestoneRoute !== 'hud') {
      return
    }

    if (params.state === 'running') {
      this.researchQuestions.set(params.questionId, params)
      return
    }

    this.researchQuestions.delete(params.questionId)
  }

  private finishResearch(): void {
    if (this.researchDone) {
      return
    }

    this.researchDone = true
    const hadTransientState = this.researchQuestions.size > 0

    for (const questionId of this.researchQuestions.keys()) {
      this.researchMilestones.delete(toResearchQuestionSlot(questionId))
    }
    this.researchQuestions.clear()

    if (hadTransientState) {
      this.scheduleEdit()
    }
  }

  private renderHudChunks(): readonly string[] {
    const milestones = [...this.researchMilestones.values()].map((milestone) => milestone.text)
    const hud: LiveRunHud = {
      elapsedMs: Math.max(0, performance.now() - this.startedAt),
      tools: [...this.tools.values()],
      milestones,
    }

    return renderLiveRunHud({
      hud,
      renderer: selectRenderer(this.deps.adapter, this.deps.useMarkup),
      maxLen: this.deps.adapter.capabilities.maxTextLen,
      locale: this.deps.locale,
    })
  }

  private setResearchMilestone(milestone: ResearchMilestone): boolean {
    const previous = this.researchMilestones.get(milestone.slot)

    if (previous?.text === milestone.text) {
      return false
    }

    if (milestone.kind === 'question' && previous === undefined) {
      const questionCount = [...this.researchMilestones.values()].filter(
        (candidate) => candidate.kind === 'question'
      ).length

      if (questionCount >= MAX_RESEARCH_QUESTIONS_LIMIT) {
        return false
      }
    }

    this.researchMilestones.set(milestone.slot, milestone)
    return true
  }

  private enqueueMilestone(milestone: ResearchMilestone): void {
    const index = this.pendingMilestones.findIndex((pending) => pending.slot === milestone.slot)

    if (index === -1) {
      this.pendingMilestones.push(milestone)
    } else {
      this.pendingMilestones[index] = milestone
    }

    this.kickMilestoneDrain()
  }

  private kickMilestoneDrain(): void {
    if (this.pendingMilestones.length > 0 && this.editTail === null) {
      this.editTail = this.drainEdits()
    }
  }

  private enqueueLatest(text: string): void {
    this.queuedText = text

    if (this.editTail !== null) {
      return
    }

    this.editTail = this.drainEdits()
  }

  private async drainEdits(): Promise<void> {
    try {
      for (;;) {
        if (this.accepting && this.queuedText !== null) {
          const text = this.queuedText
          this.queuedText = null
          await this.updatePreview(text)
          continue
        }

        if (this.deps.signal.aborted) {
          return
        }

        const milestone = this.pendingMilestones.shift()

        if (milestone === undefined) {
          return
        }

        await this.sendMilestone(milestone.text)
      }
    } finally {
      this.editTail = null
    }
  }

  private async sendMilestone(text: string): Promise<void> {
    try {
      for (const chunk of chunkResearchMilestone({
        renderer: selectRenderer(this.deps.adapter, this.deps.useMarkup),
        maxLen: this.deps.adapter.capabilities.maxTextLen,
        locale: this.deps.locale,
        text,
      })) {
        await this.deps.reply.overflow(chunk, {
          useMarkup: this.deps.useMarkup,
          signal: this.deps.signal,
        })
      }
    } catch (err: unknown) {
      this.deps.logger.warn('channel.research_milestone_failed', { err: formatErrForLog(err) })
    }
  }

  private async updatePreview(text: string): Promise<void> {
    try {
      await this.deps.reply.update(text, {
        useMarkup: this.deps.useMarkup,
        silent: true,
        keepCancel: true,
        signal: this.deps.signal,
      })
    } catch (err: unknown) {
      this.deps.logger.warn('channel.hud_update_failed', { err: formatErrForLog(err) })
    }
  }

  private updateHud(event: StreamEvent): boolean {
    switch (event.type) {
      // Elapsed is the liveness signal, so any streamed activity earns a re-render.
      case 'text_delta':
      case 'reasoning_delta':
      case 'thinking_block':
        return true
      case 'tool_execution_start':
        if (event.lifecycleOwner === 'progress') {
          return false
        }
        startLiveRunTool({ tools: this.tools, event, locale: this.deps.locale })
        return true
      case 'tool_progress':
        updateLiveRunTool({
          tools: this.tools,
          id: event.id,
          message: event.message,
          locale: this.deps.locale,
        })
        return true
      case 'tool_result':
        if (event.lifecycleOwner === 'progress') {
          return false
        }
        // A replan supersedes; a tool that is not a plan leaves the stated one alone.
        this.statedPlan =
          finishLiveRunTool({ tools: this.tools, event, locale: this.deps.locale }) ??
          this.statedPlan
        return true
      default:
        return false
    }
  }
}

function isRunningProgress(message: ResearchProgress): boolean {
  if (message.key === 'progress.researchQuestion' || message.key === 'progress.researchStage') {
    return message.params.state === 'running'
  }

  return false
}

function resolveMilestoneRoute(deps: ChunkStreamDeps): ResearchMilestoneRoute {
  if (!deps.settings.midStreamUpdates || deps.signal.aborted) {
    return 'off'
  }

  return deps.adapter.capabilities.canEdit ? 'hud' : 'messages'
}
