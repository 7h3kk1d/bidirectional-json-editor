import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LabelAllocator, LabelRegistry } from '../../src/engine/core/label'
import { labels, zoom } from '../../src/engine/core/term'
import { parse } from '../../src/engine/json/parser'
import { render } from '../../src/engine/json/render'
import { checkCst } from '../../src/engine/json/cst'
import type { SrcTerm } from '../../src/engine/json/cst'
import { buildRegistries, getFold } from '../../src/engine/json/get'
import { viewEquals } from '../../src/engine/json/view'
import type { ViewTerm } from '../../src/engine/json/view'
import { applyEdit } from '../../src/engine/incremental/changeset'
import { labelToSpan, offsetToPath, pathToSpan } from '../../src/engine/incremental/spans'
import { applyTextEditToCst } from '../../src/engine/incremental/reparse'
import { arbFormattedText, arbTextEdit } from './arbitraries'

interface State {
  cst: SrcTerm
  view: ViewTerm
  srcReg: LabelRegistry
  viewReg: LabelRegistry
  alloc: LabelAllocator
  text: string
}

function fullParse(text: string): State | null {
  const alloc = new LabelAllocator()
  const r = parse(text, 'document', alloc)
  if (!r.ok || r.consumed !== text.length) return null
  const cst = r.terms[0]
  const view = getFold(cst)
  const { srcReg, viewReg } = buildRegistries(cst, view)
  return { cst, view, srcReg, viewReg, alloc, text }
}

function checkRegistries(st: State): void {
  for (const l of labels(st.cst)) {
    const p = st.srcReg.locate(l)
    expect(p, `src label ${l} must locate`).not.toBeNull()
    expect(zoom(st.cst, p!).label).toBe(l)
  }
  for (const l of labels(st.view)) {
    const p = st.viewReg.locate(l)
    expect(p, `view label ${l} must locate`).not.toBeNull()
    expect(zoom(st.view, p!).label).toBe(l)
  }
}

describe('incremental reparse ≡ full parse', () => {
  it('single random edits', () => {
    fc.assert(
      fc.property(
        arbFormattedText.chain((text) => fc.tuple(fc.constant(text), arbTextEdit(text))),
        ([text, edit]) => {
          const st = fullParse(text)
          if (!st) return
          const newText = applyEdit(text, edit)
          const fresh = fullParse(newText)
          const r = applyTextEditToCst({ ...st, newText, edit })
          if (fresh === null) {
            expect(r.ok).toBe(false)
            return
          }
          expect(r.ok, `edit ${JSON.stringify(edit)} on ${JSON.stringify(text)}`).toBe(true)
          if (!r.ok) return
          checkCst(r.cst)
          expect(render(r.cst)).toBe(newText)
          expect(viewEquals(r.view, fresh.view)).toBe(true)
          checkRegistries({ ...st, cst: r.cst, view: r.view, text: newText })
        },
      ),
      { numRuns: 300 },
    )
  })

  it('sequences of edits keep incremental state equal to full parses', () => {
    fc.assert(
      fc.property(
        arbFormattedText.chain((t0) =>
          fc.tuple(fc.constant(t0), fc.array(fc.nat(), { minLength: 1, maxLength: 6 })),
        ),
        fc.nat(),
        ([t0], seed) => {
          let st = fullParse(t0)
          if (!st) return
          let text = t0
          let rng = seed
          for (let step = 0; step < 5; step++) {
            rng = (rng * 1103515245 + 12345) & 0x7fffffff
            const from = rng % (text.length + 1)
            rng = (rng * 1103515245 + 12345) & 0x7fffffff
            const to = Math.min(text.length, from + (rng % 4))
            const inserts = ['', ' ', '1', 'true', '"x"', ',', '[]', '\n  ']
            rng = (rng * 1103515245 + 12345) & 0x7fffffff
            const edit = { from, to, insert: inserts[rng % inserts.length] }
            const newText = applyEdit(text, edit)
            const fresh = fullParse(newText)
            const r = applyTextEditToCst({ ...st, newText, edit })
            if (fresh === null) {
              expect(r.ok).toBe(false)
              return // dirty protocol is session-level; stop this run
            }
            expect(r.ok).toBe(true)
            if (!r.ok) return
            expect(render(r.cst)).toBe(newText)
            expect(viewEquals(r.view, fresh.view)).toBe(true)
            st = { ...st, cst: r.cst, view: r.view, text: newText }
            checkRegistries(st)
            text = newText
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('label stability: editing one member leaves sibling labels untouched', () => {
    const text = '{\n  "a": 1,\n  "b": [true, null],\n  "c": "hi"\n}'
    const st = fullParse(text)!
    // edit inside "a"'s value: 1 -> 12
    const off = text.indexOf('1') + 1
    const edit = { from: off, to: off, insert: '2' }
    const before = new Map(
      st.view.children.map((m) => [m.children[0], m.label] as const),
    )
    const beforeLabels = st.view.children.map((m) => m.label)
    const newText = applyEdit(text, edit)
    const r = applyTextEditToCst({ ...st, newText, edit })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const afterLabels = r.view.children.map((m) => m.label)
    expect(afterLabels).toEqual(beforeLabels)
    // untouched subtrees keep object identity (structural sharing)
    expect(r.view.children[1]).toBe(st.view.children[1])
    expect(r.view.children[2]).toBe(st.view.children[2])
    expect(before.size).toBe(3)
  })

  it('whitespace fast path leaves the view untouched (identity)', () => {
    const text = '{ "a": 1 }'
    const st = fullParse(text)!
    const edit = { from: 1, to: 1, insert: '   ' } // inside the trivia after '{'
    const newText = applyEdit(text, edit)
    const r = applyTextEditToCst({ ...st, newText, edit })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.view).toBe(st.view)
    expect(r.viewPatch).toBeNull()
    expect(render(r.cst)).toBe(newText)
  })
})

describe('span oracle', () => {
  it('offsetToPath and labelToSpan agree with naive scans', () => {
    fc.assert(
      fc.property(arbFormattedText, fc.nat(), (text, offSeed) => {
        const st = fullParse(text)
        if (!st) return
        const off = text.length === 0 ? 0 : offSeed % text.length
        const p = offsetToPath(st.cst, off)
        const span = pathToSpan(st.cst, p)
        expect(span.from).toBeLessThanOrEqual(off)
        expect(off).toBeLessThan(Math.max(span.to, span.from + 1))
        // node at p must be a leaf or have no child containing off
        const node = zoom(st.cst, p)
        expect(node.children.length).toBe(0)
        // every label's span renders back to its own text slice
        for (const l of labels(st.cst)) {
          const s = labelToSpan(st.cst, st.srcReg, l)!
          const sub = zoom(st.cst, st.srcReg.locate(l)!)
          expect(text.slice(s.from, s.to)).toBe(render(sub))
        }
      }),
      { numRuns: 60 },
    )
  })
})
