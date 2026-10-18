import type { Command, Group } from '@/cli/command'
import { createCommand, createGroup } from '@/cli/command'
import { CLI_COMMAND_METADATA, CLI_ROOT_SUMMARY } from '@/cli/metadata'
import { flagList } from '@/cli/parsing/args'

const VERSION_FLAGS: ReadonlySet<string> = new Set(['--version', '-v'])
const HELP_FLAG = '--help'
const HELP_TOPIC_ARG = 'command'

export function createRoot(subcommands: readonly (Command | Group)[]): Group {
  const tree = createGroup({
    name: '',
    summary: CLI_ROOT_SUMMARY,
    subcommands: [...subcommands, createHelpCommand(() => root)],
  })
  const root: Group = {
    ...tree,
    needsFor: (argv) => tree.needsFor(toCommandArgv(argv)),
    preflight: (argv, path) => tree.preflight(toCommandArgv(argv), path),
    exec: (argv, app, path) => tree.exec(toCommandArgv(argv), app, path),
  }

  return root
}

// `help chat` is `chat --help`: the command's own help printer answers, so the two never differ.
function createHelpCommand(root: () => Group): Command {
  return createCommand({
    ...CLI_COMMAND_METADATA.help,
    spec: { positionalRest: HELP_TOPIC_ARG },
    needs: { boot: false, configFile: 'optional' },
    run: (args, app) => root().exec([...flagList(args, HELP_TOPIC_ARG), HELP_FLAG], app, []),
  })
}

// `--version` is the `version` command, so there is one implementation of what it prints.
function toCommandArgv(argv: readonly string[]): readonly string[] {
  const [head, ...rest] = argv

  return head !== undefined && VERSION_FLAGS.has(head)
    ? [CLI_COMMAND_METADATA.version.name, ...rest]
    : argv
}
