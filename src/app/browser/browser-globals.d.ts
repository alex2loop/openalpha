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
    readonly storage?: { readonly getDirectory?: () => Promise<unknown> }
  }

  const FileSystemFileHandle: { readonly prototype: object } | undefined
}
