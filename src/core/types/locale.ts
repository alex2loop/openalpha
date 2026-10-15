export const LOCALES = Object.freeze(['en', 'vi'] as const)

export type Locale = (typeof LOCALES)[number]
