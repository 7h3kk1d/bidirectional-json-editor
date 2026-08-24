/**
 * Pull lexer for strict JSON with whitespace runs as first-class tokens.
 * Offsets are UTF-16 code units (the CodeMirror convention).
 */

export type Token =
  | { kind: 'punct'; ch: '{' | '}' | '[' | ']' | ',' | ':'; start: number; end: number }
  | { kind: 'string'; lexeme: string; value: string; start: number; end: number }
  | { kind: 'number'; lexeme: string; value: number; start: number; end: number }
  | { kind: 'bool'; value: boolean; lexeme: 'true' | 'false'; start: number; end: number }
  | { kind: 'null'; start: number; end: number }
  | { kind: 'trivia'; text: string; start: number; end: number }
  | { kind: 'eof'; start: number; end: number }

export class LexError extends Error {
  constructor(
    public pos: number,
    public expected: string,
  ) {
    super(`lex error at ${pos}: expected ${expected}`)
  }
}

const WS = new Set([' ', '\t', '\n', '\r'])
const DIGITS = new Set('0123456789')

export class Lexer {
  private pos: number
  private lookahead: Token | null = null

  constructor(
    private text: string,
    start = 0,
  ) {
    this.pos = start
  }

  peek(): Token {
    if (this.lookahead === null) this.lookahead = this.lex()
    return this.lookahead
  }

  next(): Token {
    const t = this.peek()
    this.lookahead = null
    return t
  }

  /** Current position (start of the next unconsumed token). */
  position(): number {
    return this.lookahead ? this.lookahead.start : this.pos
  }

  private lex(): Token {
    const s = this.text
    const start = this.pos
    if (start >= s.length) return { kind: 'eof', start, end: start }
    const c = s[start]
    if (WS.has(c)) {
      let i = start + 1
      while (i < s.length && WS.has(s[i])) i++
      this.pos = i
      return { kind: 'trivia', text: s.slice(start, i), start, end: i }
    }
    switch (c) {
      case '{':
      case '}':
      case '[':
      case ']':
      case ',':
      case ':':
        this.pos = start + 1
        return { kind: 'punct', ch: c, start, end: start + 1 }
      case '"':
        return this.lexString(start)
      case 't':
        return this.lexKeyword(start, 'true', { kind: 'bool', value: true, lexeme: 'true' })
      case 'f':
        return this.lexKeyword(start, 'false', { kind: 'bool', value: false, lexeme: 'false' })
      case 'n':
        return this.lexKeyword(start, 'null', { kind: 'null' })
      default:
        if (c === '-' || DIGITS.has(c)) return this.lexNumber(start)
        throw new LexError(start, 'a JSON value')
    }
  }

  private lexKeyword(
    start: number,
    word: string,
    tok: { kind: 'bool'; value: boolean; lexeme: 'true' | 'false' } | { kind: 'null' },
  ): Token {
    if (this.text.slice(start, start + word.length) !== word) {
      throw new LexError(start, `'${word}'`)
    }
    this.pos = start + word.length
    return { ...tok, start, end: this.pos } as Token
  }

  private lexString(start: number): Token {
    const s = this.text
    let i = start + 1
    let value = ''
    for (;;) {
      if (i >= s.length) throw new LexError(i, 'closing \'"\'')
      const ch = s[i]
      if (ch === '"') {
        i++
        this.pos = i
        return { kind: 'string', lexeme: s.slice(start, i), value, start, end: i }
      }
      if (ch === '\\') {
        if (i + 1 >= s.length) throw new LexError(i + 1, 'escape character')
        const e = s[i + 1]
        switch (e) {
          case '"': value += '"'; i += 2; break
          case '\\': value += '\\'; i += 2; break
          case '/': value += '/'; i += 2; break
          case 'b': value += '\b'; i += 2; break
          case 'f': value += '\f'; i += 2; break
          case 'n': value += '\n'; i += 2; break
          case 'r': value += '\r'; i += 2; break
          case 't': value += '\t'; i += 2; break
          case 'u': {
            const hex = s.slice(i + 2, i + 6)
            if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new LexError(i + 2, 'four hex digits')
            }
            value += String.fromCharCode(parseInt(hex, 16))
            i += 6
            break
          }
          default:
            throw new LexError(i + 1, 'a valid escape')
        }
        continue
      }
      const code = ch.charCodeAt(0)
      if (code < 0x20) throw new LexError(i, 'no control characters inside strings')
      value += ch
      i++
    }
  }

  private lexNumber(start: number): Token {
    const s = this.text
    let i = start
    if (s[i] === '-') i++
    if (i >= s.length || !DIGITS.has(s[i])) throw new LexError(i, 'a digit')
    if (s[i] === '0') {
      i++
    } else {
      while (i < s.length && DIGITS.has(s[i])) i++
    }
    if (s[i] === '.') {
      i++
      if (i >= s.length || !DIGITS.has(s[i])) throw new LexError(i, 'a digit after the decimal point')
      while (i < s.length && DIGITS.has(s[i])) i++
    }
    if (s[i] === 'e' || s[i] === 'E') {
      i++
      if (s[i] === '+' || s[i] === '-') i++
      if (i >= s.length || !DIGITS.has(s[i])) throw new LexError(i, 'a digit in the exponent')
      while (i < s.length && DIGITS.has(s[i])) i++
    }
    const lexeme = s.slice(start, i)
    this.pos = i
    return { kind: 'number', lexeme, value: Number(lexeme), start, end: i }
  }
}
