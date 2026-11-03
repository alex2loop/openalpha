// The parts of the File System Access API the TypeScript DOM library does not carry yet. Only
// Chromium has them; the page checks `canPickSaveFile` before it calls any.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}

interface Window {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}
