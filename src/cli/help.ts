import type { Spec } from '@/cli/parsing/args'
import type { LocalizedText, Writer } from '@/cli/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import { hint, style } from '@/cli/ui/colors'
import { t } from '@/i18n'

const CAMEL_BOUNDARY_RE = /([A-Z])/g

interface HelpOutput {
  readonly config: ResolvedConfig
  readonly out: Writer
}

interface CommandHelp {
  readonly name: string
  readonly summary: LocalizedText
  readonly spec?: Spec
}

export function printCommandHelp(
  def: CommandHelp,
  output: HelpOutput,
  path: readonly string[]
): void {
  const locale = output.config.locale.language
  const full = [...path, def.name].filter(Boolean).join(' ')
  const positionals = def.spec?.positional ?? []
  const rest = def.spec?.positionalRest
  const positionalUsage = [
    ...positionals.map((name) => (def.spec?.positionalOptional ? `[${name}]` : `<${name}>`)),
    ...(rest === undefined ? [] : [`[${rest}...]`]),
  ].join(' ')
  output.out(style.heading(full))
  output.out(`  ${renderLocalized(locale, def.summary)}`)
  output.out('')
  output.out(style.heading(t(locale, 'cliHelp.headingUsage')))
  output.out(`  ${full}${positionalUsage === '' ? '' : ` ${positionalUsage}`}`)

  printFlags(def.spec, output, t(locale, 'cliHelp.headingFlags'))
}

interface GroupHelp {
  readonly name: string
  readonly summary: LocalizedText
  /** The subcommand a bare invocation runs. */
  readonly default?: string
  readonly subcommands: readonly {
    readonly name: string
    readonly summary: LocalizedText
    readonly spec?: Spec
  }[]
}

export function printGroupHelp(def: GroupHelp, output: HelpOutput, path: readonly string[]): void {
  const locale = output.config.locale.language
  const full = [...path, def.name].filter(Boolean).join(' ')

  if (full !== '') {
    output.out(style.heading(full))
  }

  output.out(`  ${renderLocalized(locale, def.summary)}`)
  output.out('')
  output.out(style.heading(t(locale, 'cliHelp.headingCommands')))

  const width = Math.max(...def.subcommands.map((sub) => sub.name.length), 0)

  for (const sub of def.subcommands) {
    const mark = sub.name === def.default ? ` ${t(locale, 'cliHelp.groupDefaultMark')}` : ''
    output.out(`  ${sub.name.padEnd(width)}  ${hint(renderLocalized(locale, sub.summary))}${mark}`)
  }

  const defaultSub = def.subcommands.find((sub) => sub.name === def.default)

  if (defaultSub !== undefined) {
    const command = [full, defaultSub.name].filter(Boolean).join(' ')
    printFlags(defaultSub.spec, output, t(locale, 'cliHelp.headingDefaultFlags', { command }))
  }
}

function printFlags(spec: Spec | undefined, output: HelpOutput, heading: string): void {
  const flags = Object.entries(spec?.flags ?? {})

  if (flags.length === 0) {
    return
  }

  const locale = output.config.locale.language

  output.out('')
  output.out(style.heading(heading))

  for (const [name, flag] of flags) {
    const alias = flag.alias === undefined ? '    ' : `-${flag.alias}, `
    output.out(`  ${alias}--${toKebab(name)}${flagValueHint(flag)}`)

    if (flag.describe !== undefined) {
      output.out(hint(`        ${renderLocalized(locale, flag.describe)}`))
    }
  }
}

function flagValueHint(flag: NonNullable<Spec['flags']>[string]): string {
  if (flag.type !== 'string') {
    return ''
  }

  return flag.choices === undefined ? ' <value>' : ` <${flag.choices.join('|')}>`
}

function toKebab(name: string): string {
  return name.replace(CAMEL_BOUNDARY_RE, (_whole, char: string) => `-${char.toLowerCase()}`)
}

export function renderLocalized(
  locale: ResolvedConfig['locale']['language'],
  text: LocalizedText
): string {
  return t(locale, text.key, text.params === undefined ? undefined : { ...text.params })
}
