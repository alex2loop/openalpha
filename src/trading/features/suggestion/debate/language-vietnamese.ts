import { foldText } from '@/core/utils/text'

/** A Vietnamese syllable is consonants, one vowel run, consonants — there are no clusters that
 *  break the run, so a model that fuses two syllables into `tíchquant` leaves two runs behind. */
const SYLLABLE = /^[^aeiouy]*[aeiouy]+[^aeiouy]*$/
/** Prose is lowercase but for its first letter. `HĐQT` and `modelMặcĐịnh` carry Vietnamese letters
 *  without being Vietnamese words, and an abbreviation or an identifier has no syllable shape. */
const PROSE = /^\p{Lu}?\p{Ll}+$/u
/** What marks a token as Vietnamese at all. An unmarked token is skipped: nothing about `P/E` or
 *  `TVL` says it is legitimate, so judging it would reject what the model wrote correctly. */
const MARKED = /[̀-ͯ]|đ/i

export function isBrokenVietnamese(token: string): boolean {
  return PROSE.test(token) && MARKED.test(token.normalize('NFD')) && !SYLLABLE.test(foldText(token))
}
