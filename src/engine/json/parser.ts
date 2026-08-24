/**
 * Recursive-descent parser producing the formatting-preserving CST.
 *
 * Three entries (needed by incremental reparse — a reparsed region can be a
 * whole document, a single value, or one object member, possibly surrounded
 * by whitespace that must be hoisted to sibling position):
 *   document       -> Document term (requires full consumption by caller)
 *   valueFragment  -> [Trivia?, value, Trivia?]
 *   memberFragment -> [Trivia?, member, Trivia?]
 */

import type { LabelAllocator } from '../core/label'
import type { SrcTerm } from './cst'
import { mkBoolLit, mkNullLit, mkNumberLit, mkPunct, mkStringLit, mkTrivia, srcOps } from './cst'
import { LexError, Lexer } from './lexer'
import type { Token } from './lexer'

export type Entry = 'document' | 'valueFragment' | 'memberFragment'

export type ParseResult =
  | { ok: true; terms: readonly SrcTerm[]; consumed: number }
  | { ok: false; pos: number; expected: string }

class ParseError extends Error {
  constructor(
    public pos: number,
    public expected: string,
  ) {
    super(`parse error at ${pos}: expected ${expected}`)
  }
}

export function parse(text: string, entry: Entry, alloc: LabelAllocator): ParseResult {
  const p = new Parser(text, alloc)
  try {
    switch (entry) {
      case 'document': {
        const doc = p.parseDocument()
        return { ok: true, terms: [doc], consumed: p.consumed() }
      }
      case 'valueFragment': {
        const terms = p.parseFragment('value')
        return { ok: true, terms, consumed: p.consumed() }
      }
      case 'memberFragment': {
        const terms = p.parseFragment('member')
        return { ok: true, terms, consumed: p.consumed() }
      }
    }
  } catch (e) {
    if (e instanceof ParseError || e instanceof LexError) {
      return { ok: false, pos: e.pos, expected: e.expected }
    }
    throw e
  }
}

class Parser {
  private lx: Lexer

  constructor(
    text: string,
    private alloc: LabelAllocator,
  ) {
    this.lx = new Lexer(text)
  }

  consumed(): number {
    return this.lx.position()
  }

  parseDocument(): SrcTerm {
    const children: SrcTerm[] = []
    this.takeTrivia(children)
    children.push(this.parseValue())
    this.takeTrivia(children)
    return srcOps.make(this.alloc.fresh(), { kind: 'Document', len: 0 }, children)
  }

  parseFragment(what: 'value' | 'member'): SrcTerm[] {
    const out: SrcTerm[] = []
    this.takeTrivia(out)
    out.push(what === 'value' ? this.parseValue() : this.parseMember())
    this.takeTrivia(out)
    return out
  }

  private takeTrivia(into: SrcTerm[]): void {
    const t = this.lx.peek()
    if (t.kind === 'trivia') {
      this.lx.next()
      into.push(mkTrivia(this.alloc.fresh(), t.text))
    }
  }

  private parseValue(): SrcTerm {
    const t = this.lx.peek()
    switch (t.kind) {
      case 'string':
        this.lx.next()
        return mkStringLit(this.alloc.fresh(), t.lexeme, t.value)
      case 'number':
        this.lx.next()
        return mkNumberLit(this.alloc.fresh(), t.lexeme, t.value)
      case 'bool':
        this.lx.next()
        return mkBoolLit(this.alloc.fresh(), t.value)
      case 'null':
        this.lx.next()
        return mkNullLit(this.alloc.fresh())
      case 'punct':
        if (t.ch === '{') return this.parseObject()
        if (t.ch === '[') return this.parseArray()
        throw new ParseError(t.start, 'a JSON value')
      default:
        throw new ParseError(t.start, 'a JSON value')
    }
  }

  private parseObject(): SrcTerm {
    const children: SrcTerm[] = []
    children.push(this.expectPunct('{'))
    this.takeTrivia(children)
    let first = this.lx.peek()
    if (first.kind === 'punct' && first.ch === '}') {
      children.push(this.expectPunct('}'))
      return srcOps.make(this.alloc.fresh(), { kind: 'Object', len: 0 }, children)
    }
    for (;;) {
      children.push(this.parseMember())
      this.takeTrivia(children)
      const t = this.lx.peek()
      if (t.kind === 'punct' && t.ch === ',') {
        children.push(this.expectPunct(','))
        this.takeTrivia(children)
        continue
      }
      if (t.kind === 'punct' && t.ch === '}') {
        children.push(this.expectPunct('}'))
        return srcOps.make(this.alloc.fresh(), { kind: 'Object', len: 0 }, children)
      }
      throw new ParseError(t.start, "',' or '}'")
    }
  }

  private parseArray(): SrcTerm {
    const children: SrcTerm[] = []
    children.push(this.expectPunct('['))
    this.takeTrivia(children)
    const first = this.lx.peek()
    if (first.kind === 'punct' && first.ch === ']') {
      children.push(this.expectPunct(']'))
      return srcOps.make(this.alloc.fresh(), { kind: 'Array', len: 0 }, children)
    }
    for (;;) {
      children.push(this.parseValue())
      this.takeTrivia(children)
      const t = this.lx.peek()
      if (t.kind === 'punct' && t.ch === ',') {
        children.push(this.expectPunct(','))
        this.takeTrivia(children)
        continue
      }
      if (t.kind === 'punct' && t.ch === ']') {
        children.push(this.expectPunct(']'))
        return srcOps.make(this.alloc.fresh(), { kind: 'Array', len: 0 }, children)
      }
      throw new ParseError(t.start, "',' or ']'")
    }
  }

  private parseMember(): SrcTerm {
    const children: SrcTerm[] = []
    const key = this.lx.peek()
    if (key.kind !== 'string') throw new ParseError(key.start, 'an object key (string)')
    this.lx.next()
    children.push(mkStringLit(this.alloc.fresh(), key.lexeme, key.value))
    this.takeTrivia(children)
    children.push(this.expectPunct(':'))
    this.takeTrivia(children)
    children.push(this.parseValue())
    return srcOps.make(this.alloc.fresh(), { kind: 'Member', len: 0 }, children)
  }

  private expectPunct(ch: '{' | '}' | '[' | ']' | ',' | ':'): SrcTerm {
    const t = this.lx.peek()
    if (t.kind !== 'punct' || t.ch !== ch) {
      throw new ParseError(t.start, `'${ch}'`)
    }
    this.lx.next()
    return mkPunct(this.alloc.fresh(), ch)
  }
}

/** Peek helper used by parseObject's empty case. */
export type { Token }
