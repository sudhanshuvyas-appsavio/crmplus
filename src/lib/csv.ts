/** A small, dependency-free CSV reader/writer.
 *
 *  Good enough for exporting/importing a few hundred reference-data rows
 *  (Companies, and anything else that grows the same need later) -- handles
 *  quoted fields, commas and newlines inside quotes, and "" as an escaped
 *  quote, per RFC 4180. Not trying to be a streaming parser for huge files. */

/** Parses CSV text into rows of raw string cells. The header row (if any)
 *  is just row 0 -- callers that expect headers slice it off themselves. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  // Normalise line endings up front so \r\n and \r don't produce blank rows.
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  // Flush the last cell/row -- a file without a trailing newline would
  // otherwise lose its final value.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  // Drop fully-blank trailing rows (a common trailing-newline artifact).
  while (rows.length > 0 && (rows[rows.length - 1]?.every((c) => c === '') ?? false)) rows.pop()

  return rows
}

function quoteCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Builds CSV text from a header row and an array of plain objects, reading
 *  each column by key. undefined/null become an empty cell. */
export function toCSV<T extends object>(columns: readonly string[], rows: T[]): string {
  const lines = [columns.map(quoteCell).join(',')]
  for (const row of rows) {
    lines.push(
      columns
        .map((col) => {
          const value = (row as Record<string, unknown>)[col]
          if (value === null || value === undefined) return ''
          if (Array.isArray(value)) return quoteCell(value.join('; '))
          return quoteCell(String(value))
        })
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

/** Triggers a browser download of `content` as a file -- no server round trip. */
export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}