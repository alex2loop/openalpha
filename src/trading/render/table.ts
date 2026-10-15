/** Separates padded cells inside a table row, after the row is already indented. */
const COLUMN_GAP = '  '

export type ColumnAlign = 'left' | 'right'

/** Rows padded to the widest cell in each column, so the values under one header line up. The
 *  caller places the block: a table knows its columns, never its indent. An empty row list pads
 *  nothing and returns nothing, so a section with no rows never reaches this. */
export function toTable(
  rows: readonly (readonly string[])[],
  aligns: readonly ColumnAlign[]
): readonly string[] {
  const widths = aligns.map((_, column) =>
    rows.reduce((widest, row) => Math.max(widest, (row[column] ?? '').length), 0)
  )

  return rows.map((row) => padCells(row, aligns, widths).join(COLUMN_GAP).trimEnd())
}

function padCells(
  row: readonly string[],
  aligns: readonly ColumnAlign[],
  widths: readonly number[]
): readonly string[] {
  return row.map((cell, column) => {
    const width = widths[column] ?? 0

    return aligns[column] === 'right' ? cell.padStart(width) : cell.padEnd(width)
  })
}
