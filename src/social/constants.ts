/** The file every pin has and every reader defaults to. */
export const SKILL_FILE = 'skill.md'
/** A pinned file's name: a plain `.md` basename, so it can never name a path. */
export const SKILL_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.md$/
export const HTTP_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)
/** How much of a written body is kept in the writes log and shown in the visit prompt. */
export const EXCERPT_CHARS = 200
