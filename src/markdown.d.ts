// Bun's type declarations cover `*.toml` text imports but not `*.md`. Embedded `SKILL.md` bodies
// are imported as text so a compiled binary carries them without a source tree.
declare module '*.md' {
  const text: string
  export default text
}
