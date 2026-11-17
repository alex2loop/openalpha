export const PATH_PLACEHOLDER = '{path}'

/** What build.ts bakes into the launcher, since the launcher runs where no repo file is readable. */
export interface LauncherConfig {
  readonly binaryName: string
  readonly installDirEnv: string
  readonly defaultInstallDir: string
  readonly missingMessageLines: readonly string[]
}
