// Extensions that are binary regardless of content — a cheap pre-filter before any read.
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.wasm',
  '.o',
  '.a',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.sqlite',
  '.db',
  '.bin',
  '.lockb',
  '.node',
  '.mp3',
  '.mp4',
  '.wav',
  '.mov',
  '.avi',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
])

export function hasBinaryExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')

  if (dot === -1) {
    return false
  }

  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase())
}
