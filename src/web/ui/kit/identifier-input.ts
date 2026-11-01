/** What a field holding an identifier (a model id, an agent id, a ticker, a key) takes: no spelling
 *  help, so the browser neither marks nor changes what is typed. */
export const IDENTIFIER_INPUT = Object.freeze({
  spellcheck: false,
  autocapitalize: 'off',
  autocorrect: 'off',
} as const)
