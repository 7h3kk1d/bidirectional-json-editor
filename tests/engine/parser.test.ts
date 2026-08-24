import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LabelAllocator } from '../../src/engine/core/label'
import { parse } from '../../src/engine/json/parser'
import { render } from '../../src/engine/json/render'
import { checkCst } from '../../src/engine/json/cst'
import { getFold } from '../../src/engine/json/get'
import { labels } from '../../src/engine/core/term'
import { toPlainJson } from '../../src/engine/json/view'
import { arbFormattedText, arbJson } from './arbitraries'

describe('parser round trip', () => {
  it('render(parse(text)) === text, and the CST invariants hold', () => {
    fc.assert(
      fc.property(arbFormattedText, (text) => {
        const r = parse(text, 'document', new LabelAllocator())
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.consumed).toBe(text.length)
        const doc = r.terms[0]
        checkCst(doc)
        expect(render(doc)).toBe(text)
      }),
      { numRuns: 200 },
    )
  })

  it('rejects invalid JSON', () => {
    for (const bad of ['', '  ', '{', '[1,]', '{"a" 1}', '{"a":}', '01', '1.', 'tru', '"\\x"', '[1]]', '{} {}', "'a'"]) {
      const r = parse(bad, 'document', new LabelAllocator())
      const fullyConsumed = r.ok && r.consumed === bad.length
      expect(fullyConsumed, `should reject: ${JSON.stringify(bad)}`).toBe(false)
    }
  })

  it('fragment entries hoist boundary trivia to sibling position', () => {
    const r = parse('  "key" : 42 ', 'memberFragment', new LabelAllocator())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.terms.map((t) => t.data.kind)).toEqual(['Trivia', 'Member', 'Trivia'])
  })
})

describe('get', () => {
  it('toPlainJson(get(parse(pretty(v)))) deep-equals v', () => {
    fc.assert(
      fc.property(arbJson, (v) => {
        const text = JSON.stringify(v, null, 2)
        const r = parse(text, 'document', new LabelAllocator())
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(toPlainJson(getFold(r.terms[0]))).toEqual(v)
      }),
      { numRuns: 200 },
    )
  })

  it('label conservation: labels(view) ⊆ labels(cst), no invention', () => {
    fc.assert(
      fc.property(arbFormattedText, (text) => {
        const r = parse(text, 'document', new LabelAllocator())
        if (!r.ok) return
        const src = labels(r.terms[0])
        for (const l of labels(getFold(r.terms[0]))) {
          expect(src.has(l)).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })
})
