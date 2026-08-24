/**
 * Formatting inference — detected once per document, used only where no
 * sibling formatting can be cloned (e.g. inserting into an empty container).
 */

export interface FormatContext {
  indentUnit: string
  newline: '\n' | '\r\n'
}

export function detectFormat(text: string): FormatContext {
  const newline: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  let indentUnit = '  '
  const counts = new Map<string, number>()
  let prevIndent = 0
  for (const line of text.split(/\r?\n/)) {
    const m = /^[ \t]*/.exec(line)![0]
    if (line.trim().length === 0) continue
    if (m.includes('\t')) {
      counts.set('\t', (counts.get('\t') ?? 0) + 1)
    } else if (m.length > prevIndent) {
      const d = m.length - prevIndent
      counts.set(' '.repeat(d), (counts.get(' '.repeat(d)) ?? 0) + 1)
    }
    prevIndent = m.length
  }
  let best = 0
  for (const [unit, n] of counts) {
    if (n > best) {
      best = n
      indentUnit = unit
    }
  }
  return { indentUnit, newline }
}

/** Leading whitespace of the line containing `offset`. */
export function lineIndentAt(text: string, offset: number): string {
  let start = text.lastIndexOf('\n', offset - 1) + 1
  let i = start
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  return text.slice(start, i)
}
