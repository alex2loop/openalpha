// The root program has no DOM lib; these are the only browser globals the worker reads, declared
// as optional so a missing API is a branch the code must take.
export {}

declare global {
  interface BrowserLockOptions {
    readonly ifAvailable: boolean
    readonly steal: boolean
  }

  interface BrowserLockManager {
    request(
      name: string,
      options: BrowserLockOptions,
      callback: (lock: object | null) => Promise<void>
    ): Promise<void>
  }

  interface Navigator {
    readonly locks?: BrowserLockManager
    readonly storage?: {
      readonly getDirectory?: () => Promise<unknown>
      readonly persist?: () => Promise<boolean>
      readonly persisted?: () => Promise<boolean>
    }
  }

  const FileSystemFileHandle: { readonly prototype: object } | undefined

  /** The web app's public address, written into the worker by the build (`--app-url`). */
  const APP_URL: string

  /** The worker's own address: the wasm file sits beside the script. */
  const location: { readonly href: string }
}
