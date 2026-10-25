import { type Signal, useSignal } from '@preact/signals'
import { useMemo } from 'preact/hooks'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

import { pluralKey } from '@/i18n'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { type ConfigTree, isTree, readConfigTree, saveConfigTree } from '@/web/state/settings'
import { toErrorText, toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { SettingRow, useDraft } from '@/web/ui/settings/row'

const EDITOR_ROWS = 18
const PATH_SEPARATOR = '.'

/** What the last "Kiểm tra" found in `text`; it stops counting once the text changes. */
type Check =
  | {
      readonly kind: 'valid'
      readonly text: string
      readonly tree: ConfigTree
      readonly count: number
    }
  | { readonly kind: 'refused'; readonly text: string; readonly lines: readonly string[] }

/** Nâng cao: the whole config file as text. The text lives in this component and is dropped when
 *  the dialog closes; nothing in it is logged or kept. */
export function AdvancedSection() {
  const read = useLoad(readConfigTree).value

  if (read.status === 'loading') {
    return <Skeleton lines={4} />
  }

  return read.status === 'failed' ? (
    <p class="failure-line">{toFailureText(read.failure)}</p>
  ) : (
    <Editor tree={read.value} />
  )
}

function Editor({ tree }: { readonly tree: ConfigTree }) {
  const original = useMemo(() => stringifyToml(tree), [tree])
  const { draft, isChanged, markSaved } = useDraft(original)
  const check = useSignal<Check | undefined>(undefined)
  const current = check.value
  const isChecked = current?.kind === 'valid' && current.text === draft.value

  return (
    <SettingRow
      title={tr('ui.office.advanced.title')}
      timing="restart"
      isChanged={isChanged}
      isReady={isChecked}
      extra={<CheckControls draft={draft} tree={tree} check={check} />}
      onSave={async () => {
        if (current?.kind === 'valid') {
          await saveConfigTree(current.tree, 'raw')
          markSaved()
        }
      }}
    >
      <textarea
        class="mono setting-editor"
        rows={EDITOR_ROWS}
        spellcheck={false}
        autocomplete="off"
        value={draft.value}
        onInput={(event) => {
          draft.value = event.currentTarget.value
        }}
      />
      <CheckResult check={current} text={draft.value} />
    </SettingRow>
  )
}

interface CheckControlsProps {
  readonly draft: Signal<string>
  readonly tree: ConfigTree
  readonly check: Signal<Check | undefined>
}

function CheckControls({ draft, tree, check }: CheckControlsProps) {
  const isBusy = useSignal(false)

  return (
    <Button
      size="small"
      disabled={isBusy.value}
      onClick={() => {
        isBusy.value = true
        validateText(draft.value, tree)
          .then((result) => {
            check.value = result
          })
          .finally(() => {
            isBusy.value = false
          })
      }}
    >
      {tr('ui.office.advanced.check')}
    </Button>
  )
}

function CheckResult({
  check,
  text,
}: {
  readonly check: Check | undefined
  readonly text: string
}) {
  if (check === undefined || check.text !== text) {
    return null
  }

  if (check.kind === 'refused') {
    return (
      <div role="alert">
        {check.lines.map((line) => (
          <p key={line} class="failure-line">
            {line}
          </p>
        ))}
      </div>
    )
  }

  return (
    <p class="meta">
      {tr(pluralKey(check.count, 'ui.office.advanced.validOne', 'ui.office.advanced.valid'), {
        count: check.count,
      })}
    </p>
  )
}

// Reads the text as TOML, then asks the daemon whether it would start on it. Neither step writes.
async function validateText(text: string, before: ConfigTree): Promise<Check> {
  let parsed: unknown

  try {
    parsed = parseToml(text)
  } catch (error: unknown) {
    const reason = error instanceof Error ? (error.message.split('\n')[0] ?? '') : ''

    return { kind: 'refused', text, lines: [tr('ui.office.advanced.notToml', { reason })] }
  }

  if (!isTree(parsed)) {
    return { kind: 'refused', text, lines: [tr('ui.office.error.generic')] }
  }

  try {
    const checked = await sendJson('POST', ROUTES.configValidate, { body: parsed })

    return checked.ok
      ? { kind: 'valid', text, tree: parsed, count: countChanged(before, parsed) }
      : {
          kind: 'refused',
          text,
          lines: (checked.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`),
        }
  } catch (error: unknown) {
    return { kind: 'refused', text, lines: [toErrorText(error)] }
  }
}

// How many values differ, a list counting as one value.
function countChanged(before: ConfigTree, after: ConfigTree): number {
  const was = flatten(before, '', new Map())
  const now = flatten(after, '', new Map())
  const paths = new Set([...was.keys(), ...now.keys()])

  return [...paths].filter((path) => was.get(path) !== now.get(path)).length
}

function flatten(value: unknown, path: string, into: Map<string, string>): Map<string, string> {
  if (!isTree(value)) {
    into.set(path, JSON.stringify(value))

    return into
  }

  for (const [key, held] of Object.entries(value)) {
    flatten(held, path === '' ? key : `${path}${PATH_SEPARATOR}${key}`, into)
  }

  return into
}
