/**
 * render — CST back to text by concatenating lexemes. The foundational
 * round-trip law: render(parse(text)) === text.
 */

import type { SrcTerm } from './cst'

export function render(t: SrcTerm): string {
  const parts: string[] = []
  emit(t, parts)
  return parts.join('')
}

function emit(t: SrcTerm, out: string[]): void {
  const d = t.data
  switch (d.kind) {
    case 'StringLit':
    case 'NumberLit':
    case 'BoolLit':
      out.push(d.lexeme)
      return
    case 'NullLit':
      out.push('null')
      return
    case 'Punct':
      out.push(d.ch)
      return
    case 'Trivia':
      out.push(d.text)
      return
    default:
      for (const c of t.children) emit(c, out)
  }
}
