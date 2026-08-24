/**
 * The JSON concrete syntax tree — the SOURCE of the bidirectional
 * transformation. Formatting is preserved exactly: whitespace runs and
 * punctuation are explicit token children (never attached fields), so
 *   - a node's length is the sum of its children's lengths (spans are
 *     lengths, not absolute offsets — see incremental/spans.ts),
 *   - formatting preservation in putSt = reusing token children verbatim,
 *   - one-hole contexts and splicing stay uniform across all node kinds.
 */

import type { Term, TermOps } from '../core/term'
import type { Label } from '../core/label'

export type PunctCh = '{' | '}' | '[' | ']' | ',' | ':'

export type SData =
  | { kind: 'Document'; len: number } // children: Trivia?, Value, Trivia?
  | { kind: 'Object'; len: number } //   children: '{' (Trivia|Member|',')* '}'
  | { kind: 'Array'; len: number } //    children: '[' (Trivia|Value|',')* ']'
  | { kind: 'Member'; len: number } //   children: StringLit Trivia? ':' Trivia? Value
  | { kind: 'StringLit'; lexeme: string; value: string; len: number } // lexeme incl. quotes
  | { kind: 'NumberLit'; lexeme: string; value: number; len: number }
  | { kind: 'BoolLit'; lexeme: 'true' | 'false'; value: boolean; len: number }
  | { kind: 'NullLit'; len: number }
  | { kind: 'Punct'; ch: PunctCh; len: number }
  | { kind: 'Trivia'; text: string; len: number } // maximal whitespace run

export type SKind = SData['kind']
export type SrcTerm = Term<SData>

const INTERIOR: ReadonlySet<SKind> = new Set(['Document', 'Object', 'Array', 'Member'])

export const VALUE_KINDS: ReadonlySet<SKind> = new Set([
  'Object',
  'Array',
  'StringLit',
  'NumberLit',
  'BoolLit',
  'NullLit',
])

export function isValueKind(k: SKind): boolean {
  return VALUE_KINDS.has(k)
}

export function isToken(t: SrcTerm): boolean {
  return t.data.kind === 'Punct' || t.data.kind === 'Trivia'
}

export const srcOps: TermOps<SData> = {
  make(label, data, children) {
    if (INTERIOR.has(data.kind)) {
      let len = 0
      for (const c of children) len += c.data.len
      if (len !== data.len) data = { ...data, len }
    } else if (children.length > 0) {
      throw new Error(`cst: leaf kind ${data.kind} cannot have children`)
    }
    return { label, data, children }
  },
  equalData(a, b) {
    if (a.kind !== b.kind) return false
    switch (a.kind) {
      case 'StringLit':
        return a.lexeme === (b as typeof a).lexeme
      case 'NumberLit':
        return a.lexeme === (b as typeof a).lexeme
      case 'BoolLit':
        return a.value === (b as typeof a).value
      case 'Punct':
        return a.ch === (b as typeof a).ch
      case 'Trivia':
        return a.text === (b as typeof a).text
      default:
        return true
    }
  },
}

// ---- leaf constructors ------------------------------------------------

export function mkStringLit(label: Label, lexeme: string, value: string): SrcTerm {
  return { label, data: { kind: 'StringLit', lexeme, value, len: lexeme.length }, children: [] }
}
export function mkNumberLit(label: Label, lexeme: string, value: number): SrcTerm {
  return { label, data: { kind: 'NumberLit', lexeme, value, len: lexeme.length }, children: [] }
}
export function mkBoolLit(label: Label, value: boolean): SrcTerm {
  const lexeme = value ? 'true' : 'false'
  return { label, data: { kind: 'BoolLit', lexeme, value, len: lexeme.length }, children: [] }
}
export function mkNullLit(label: Label): SrcTerm {
  return { label, data: { kind: 'NullLit', len: 4 }, children: [] }
}
export function mkPunct(label: Label, ch: PunctCh): SrcTerm {
  return { label, data: { kind: 'Punct', ch, len: 1 }, children: [] }
}
export function mkTrivia(label: Label, text: string): SrcTerm {
  return { label, data: { kind: 'Trivia', text, len: text.length }, children: [] }
}

// ---- string encoding ---------------------------------------------------

/** Encode a JS string as a JSON string lexeme with minimal escapes. */
export function encodeString(value: string): string {
  return JSON.stringify(value)
}

// ---- dev-mode invariant check -------------------------------------------

/** Assert the CST grammar and length bookkeeping. Test/dev use only. */
export function checkCst(t: SrcTerm, alloc?: { peek?: number }): void {
  void alloc
  const seen = new Set<Label>()
  const walk = (n: SrcTerm): number => {
    if (seen.has(n.label)) throw new Error(`checkCst: duplicate label ${n.label}`)
    seen.add(n.label)
    const d = n.data
    switch (d.kind) {
      case 'Document':
      case 'Object':
      case 'Array':
      case 'Member': {
        let len = 0
        let prevTrivia = false
        for (const c of n.children) {
          if (c.data.kind === 'Trivia') {
            if (prevTrivia) throw new Error('checkCst: adjacent Trivia')
            if (c.data.text.length === 0) throw new Error('checkCst: empty Trivia')
            prevTrivia = true
          } else {
            prevTrivia = false
          }
          len += walk(c)
        }
        if (len !== d.len) throw new Error(`checkCst: len mismatch on ${d.kind}`)
        return len
      }
      default:
        return d.len
    }
  }
  walk(t)
}
