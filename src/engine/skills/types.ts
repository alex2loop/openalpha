// Origin-neutral: a skill compiled into the binary carries the same metadata as one read from
// disk, so nothing downstream has to invent a path or a timestamp for it. The filesystem identity
// a directory skill also has stays private to load.ts.
export interface SkillMeta {
  readonly name: string
  readonly description: string
  readonly version?: string
  readonly author?: string
  readonly license?: string
  readonly category?: string
  readonly tags?: readonly string[]
  // Visibility gates: requiresTools (all must be loaded), fallbackForTools (none loaded),
  // platforms (current OS in list).
  readonly requiresTools?: readonly string[]
  readonly fallbackForTools?: readonly string[]
  readonly platforms?: readonly string[]
}
