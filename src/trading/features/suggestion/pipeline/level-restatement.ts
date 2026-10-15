const DIGIT = /\d/
const SEPARATOR = /[.,]/

/** Whether an invalidator names the stop or the target, in the form the plan showed the model. The
 *  stop already covers price, so a condition that restates it says nothing the plan did not, and a
 *  later run would read it as unbroken until the position was already gone. Compared as rendered
 *  text rather than as numbers, and only where the level stands as a whole number in the text. */
export function isLevelRestatement(text: string, renderedLevels: readonly string[]): boolean {
  return renderedLevels.some((level) => containsWholeNumber(text, level))
}

function containsWholeNumber(text: string, level: string): boolean {
  let at = text.indexOf(level)

  while (at !== -1) {
    if (!(continuesNumber(text, at - 1, -1) || continuesNumber(text, at + level.length, 1))) {
      return true
    }

    at = text.indexOf(level, at + 1)
  }

  return false
}

/** A digit touching a level makes it part of a longer number: `25,60` inside `125,60` or
 *  `1.825,60` is not the level. A separator does only with a digit beyond it, so the comma or
 *  full stop that ends a sentence leaves the level whole. */
function continuesNumber(text: string, index: number, step: -1 | 1): boolean {
  const character = text[index]

  if (character === undefined) {
    return false
  }

  if (DIGIT.test(character)) {
    return true
  }

  const beyond = text[index + step]

  return SEPARATOR.test(character) && beyond !== undefined && DIGIT.test(beyond)
}
