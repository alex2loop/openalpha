export const PATH_PLACEHOLDER = '{path}'
export const REASON_PLACEHOLDER = '{reason}'

/** What build.ts bakes into the launcher, since the launcher runs where no repo file is readable.
 *  Each message holds one line per locale, with the placeholders above left in. */
export interface LauncherConfig {
  readonly binaryName: string
  readonly installDirEnv: string
  readonly defaultInstallDir: string
  readonly missingMessageLines: readonly string[]
  readonly unstartableMessageLines: readonly string[]
}
