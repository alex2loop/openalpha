const COMMAND_PREFIX = '/'

interface Named {
  readonly kind: 'agent' | 'command'
  readonly name: string
  readonly title?: string
}

/** A run's title, else its agent id, or its command as the operator types it. */
export function formatRunName(run: Named): string {
  if (run.title !== undefined) {
    return run.title
  }

  return run.kind === 'command' ? `${COMMAND_PREFIX}${run.name}` : run.name
}
