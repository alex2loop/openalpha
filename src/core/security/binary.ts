const BINARY_SIGNATURES: ReadonlyArray<{ bytes: number[]; label: string }> = [
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'ELF' },
  { bytes: [0x4d, 0x5a], label: 'PE' },
  { bytes: [0xfe, 0xed, 0xfa, 0xce], label: 'Mach-O' },
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], label: 'Mach-O' },
  { bytes: [0xce, 0xfa, 0xed, 0xfe], label: 'Mach-O' },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], label: 'Mach-O' },
  // Same magic as Java class files — both classify as binary, so the collision is harmless.
  { bytes: [0xca, 0xfe, 0xba, 0xbe], label: 'Mach-O fat' },
  { bytes: [0x00, 0x61, 0x73, 0x6d], label: 'WASM' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'PNG' },
  { bytes: [0xff, 0xd8, 0xff], label: 'JPEG' },
  { bytes: [0x47, 0x49, 0x46, 0x38], label: 'GIF' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'ZIP' },
]

// One sniff window for every caller: magic bytes only need the first few, the ratio check needs
// enough of a sample to be meaningful.
const BINARY_SAMPLE_BYTES = 512
// A NUL never appears in UTF-8 text, and real text stays well under this share of control bytes.
const NUL_BYTE = 0x00
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const FIRST_PRINTABLE = 0x20
const CONTROL_BYTE_MAX_PERCENT = 30

function hasBinaryMagicBytes(buf: Buffer | Uint8Array): boolean {
  return BINARY_SIGNATURES.some(({ bytes }) => hasBytePrefix(buf, bytes))
}

// Magic bytes name the formats we know; the control-byte ratio catches the rest (sqlite, pdf, pyc,
// object files, protobuf), which would otherwise decode to a megabyte of replacement characters.
// Takes whole content and samples its own head. Empty content is not binary.
export function isBinaryContent(content: Uint8Array): boolean {
  const head = content.subarray(0, BINARY_SAMPLE_BYTES)

  return head.length > 0 && (hasBinaryMagicBytes(head) || hasBinaryByteRatio(head))
}

function hasBinaryByteRatio(head: Uint8Array): boolean {
  let control = 0

  for (const byte of head) {
    if (byte === NUL_BYTE) {
      return true
    }

    if (byte < FIRST_PRINTABLE && byte !== TAB && byte !== LINE_FEED && byte !== CARRIAGE_RETURN) {
      control++
    }
  }

  return control * 100 > head.length * CONTROL_BYTE_MAX_PERCENT
}

function hasBytePrefix(arr: Buffer | Uint8Array, bytes: readonly number[]): boolean {
  if (arr.length < bytes.length) {
    return false
  }
  for (let i = 0; i < bytes.length; i++) {
    if (arr[i] !== bytes[i]) {
      return false
    }
  }
  return true
}
