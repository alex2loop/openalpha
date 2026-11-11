import type { RunEnv, RunOptions } from '@/engine/types/run'

export function optionalEnvFields(
  options: RunOptions
): Pick<
  RunEnv,
  | 'outputContract'
  | 'answerVisibility'
  | 'reasoningVisibility'
  | 'researchInteraction'
  | 'instructions'
  | 'routingKey'
  | 'title'
  | 'subject'
> {
  return {
    ...(options.outputContract === undefined ? {} : { outputContract: options.outputContract }),
    ...(options.answerVisibility === undefined
      ? {}
      : { answerVisibility: options.answerVisibility }),
    ...(options.reasoningVisibility === undefined
      ? {}
      : { reasoningVisibility: options.reasoningVisibility }),
    ...(options.researchInteraction === undefined
      ? {}
      : { researchInteraction: options.researchInteraction }),
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    ...(options.routingKey === undefined ? {} : { routingKey: options.routingKey }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.subject === undefined ? {} : { subject: options.subject }),
  }
}
