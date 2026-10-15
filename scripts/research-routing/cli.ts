import { open, readFile } from 'node:fs/promises'

import { requiredPath, runCommand } from './command'
import {
  DIRECT_INSTRUCTION,
  EvalRecordSchema,
  LINE_RE,
  loadRoutingTaskSet,
  ManifestSchema,
  parseJson,
  ReviewedScoreSchema,
  RoutingEvalError,
  stableHash,
} from './model'
import { selfCheck } from './self-check'
import { summarizeRecords } from './summary'

export async function runRoutingEvaluator(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2)

  if (command === 'run') {
    await runCommand(parseOptions(args, new Set(['output', 'config'])))
    return
  }
  if (command === 'summarize') {
    const passes = await summarizeCommand(
      parseOptions(args, new Set(['evaluation', 'reviewed', 'output']))
    )
    if (!passes) {
      process.exitCode = 1
    }
    return
  }
  if (command === 'self-check') {
    if (args.length > 0) {
      throw new RoutingEvalError('usage', 'self-check accepts no options')
    }
    await selfCheck()
    return
  }

  throw new RoutingEvalError(
    'usage',
    'usage: evaluate-research-routing.ts run --output <jsonl> [--config <toml>] | summarize --evaluation <jsonl> --reviewed <jsonl> --output <jsonl> | self-check'
  )
}

async function summarizeCommand(options: ReadonlyMap<string, string>): Promise<boolean> {
  const evaluationPath = requiredPath(options, 'evaluation')
  const reviewedPath = requiredPath(options, 'reviewed')
  const outputPath = requiredPath(options, 'output')
  const { taskSet, raw } = await loadRoutingTaskSet()
  const evaluation = await readJsonLines(evaluationPath)
  const manifest = ManifestSchema.parse(evaluation[0])

  if (
    manifest.taskSetVersion !== taskSet.version ||
    manifest.caseCount !== taskSet.cases.length ||
    manifest.hashes.taskSetData !== stableHash(raw) ||
    manifest.hashes.budgetProfile !== stableHash(taskSet.runProfile) ||
    manifest.hashes.rubric !== stableHash(taskSet.cases.map((entry) => [entry.id, entry.rubric])) ||
    manifest.hashes.directInstruction !== stableHash(DIRECT_INSTRUCTION)
  ) {
    throw new RoutingEvalError('task_set_mismatch', 'evaluation used a different task-set file')
  }

  const records = evaluation.slice(1).map((value) => EvalRecordSchema.parse(value))
  if (records.some((record) => record.manifestId !== manifest.manifestId)) {
    throw new RoutingEvalError('manifest_mismatch', 'evaluation record manifestId mismatch')
  }
  if (
    records.some(
      (record) =>
        record.mode === 'automatic' && record.systemPromptHash !== manifest.hashes.routingPrompt
    )
  ) {
    throw new RoutingEvalError('prompt_mismatch', 'automatic routing prompt hash mismatch')
  }
  const scores = (await readJsonLines(reviewedPath)).map((value) =>
    ReviewedScoreSchema.parse(value)
  )
  const summary = summarizeRecords(taskSet, records, scores)
  const handle = await open(outputPath, 'wx')

  try {
    await handle.write(`${JSON.stringify(summary.report)}\n`)
  } finally {
    await handle.close()
  }
  return summary.passes
}

function parseOptions(
  args: readonly string[],
  allowed: ReadonlySet<string>
): ReadonlyMap<string, string> {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    const name = flag?.startsWith('--') ? flag.slice(2) : ''
    if (!allowed.has(name) || value === undefined || value.startsWith('--')) {
      throw new RoutingEvalError('usage', `invalid option: ${flag ?? '<missing>'}`)
    }
    if (options.has(name)) {
      throw new RoutingEvalError('usage', `duplicate option: --${name}`)
    }
    options.set(name, value)
  }
  return options
}

async function readJsonLines(path: string): Promise<readonly unknown[]> {
  const text = await readFile(path, 'utf8')
  return text
    .split(LINE_RE)
    .filter((line) => line.trim() !== '')
    .map((line, index) => parseJson(line, `${path}:${index + 1}`))
}
