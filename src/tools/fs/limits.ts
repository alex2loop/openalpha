// Shared filesystem-tool size cap: file_read and file_edit reject files above this before
// reading, so a large workspace file cannot multiply process memory during an edit.
export const FILE_MAX_BYTES = 1_048_576

// Permission bits of a stat mode. `stat.mode` also carries the file type (S_IFREG), which POSIX
// leaves unspecified for chmod — mask before preserving a file's mode across a replace.
export const FILE_PERMISSION_MASK = 0o7777
