const MAX_SUGGESTION_DISTANCE = 3

export function closestName(attempted: string, names: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = MAX_SUGGESTION_DISTANCE + 1

  for (const name of names) {
    const distance = editDistance(attempted, name)

    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  }

  return bestDistance <= MAX_SUGGESTION_DISTANCE ? best : undefined
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index)

  for (let i = 1; i <= left.length; i++) {
    const current = [i]

    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current.push(
        Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + cost)
      )
    }

    previous = current
  }

  return previous[right.length] ?? 0
}
