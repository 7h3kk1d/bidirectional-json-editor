import { describe, expect, it } from 'vitest'
import { EditorSession, ViewEditBlockedError } from '../../src/engine/session'
import { insertChild, setScalar } from '../../src/engine/json/edits'
import { viewEquals } from '../../src/engine/json/view'

const TEXT = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}'

describe('localized editing while dirty', () => {
  it('allows a view edit AFTER the broken region, rebased over pending edits', () => {
    const s = EditorSession.fromText(TEXT)
    // break "a"'s value: delete the 1
    const off = TEXT.indexOf('1')
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    // edit "c" (after the envelope) through the view
    const v = s.view!
    const r = s.applyViewEdit(setScalar([2, 1], 33))
    expect(r.textEdit).not.toBeNull()
    // current text got the change, hole still present
    expect(s.text).toBe('{\n  "a": ,\n  "b": 2,\n  "c": 33\n}')
    expect(s.view!.children[2].children[1].data).toMatchObject({ kind: 'VNumber', value: 33 })
    // now fix the hole by typing a value
    s.applyTextEdit({ from: s.text.indexOf(','), to: s.text.indexOf(','), insert: '7' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe('{\n  "a": 7,\n  "b": 2,\n  "c": 33\n}')
    const fresh = EditorSession.fromText(s.text)
    expect(viewEquals(fresh.view!, s.view!)).toBe(true)
    expect(v.children[1].label).toBe(s.view!.children[1].label) // labels survive
    s.checkInvariants()
  })

  it('allows a view edit BEFORE the broken region, shifting pending edits', () => {
    const s = EditorSession.fromText(TEXT)
    // break "c"'s value: replace 3 with nothing
    const off = TEXT.indexOf('3')
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    // edit "a" (before the envelope): 1 -> 42424242 (length change forces rebase)
    const r = s.applyViewEdit(setScalar([0, 1], 42424242))
    expect(r.textEdit).not.toBeNull()
    expect(s.text).toBe('{\n  "a": 42424242,\n  "b": 2,\n  "c": \n}')
    // heal the hole
    const healAt = s.text.lastIndexOf('\n}')
    s.applyTextEdit({ from: healAt, to: healAt, insert: 'true' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe('{\n  "a": 42424242,\n  "b": 2,\n  "c": true\n}')
    const fresh = EditorSession.fromText(s.text)
    expect(viewEquals(fresh.view!, s.view!)).toBe(true)
    s.checkInvariants()
  })

  it('refuses a view edit that overlaps the broken region', () => {
    const s = EditorSession.fromText(TEXT)
    const off = TEXT.indexOf('2')
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    const textBefore = s.text
    // editing "b" itself targets the broken node
    expect(() => s.applyViewEdit(setScalar([1, 1], 9))).toThrow(ViewEditBlockedError)
    // inserting into the object rewrites the container that contains the hole
    expect(() =>
      s.applyViewEdit(insertChild([], 0, { key: 'x', value: 0 }, s.freshLabels())),
    ).toThrow(ViewEditBlockedError)
    // nothing changed
    expect(s.text).toBe(textBefore)
    expect(s.state.kind).toBe('dirty')
    // still recoverable and both rejected edits left no residue
    s.applyTextEdit({ from: off, to: off, insert: '5' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe('{\n  "a": 1,\n  "b": 5,\n  "c": 3\n}')
    s.checkInvariants()
  })

  it('multiple dirty view edits interleave with text edits and recover', () => {
    const s = EditorSession.fromText(TEXT)
    const off = TEXT.indexOf('1')
    s.applyTextEdit({ from: off, to: off + 1, insert: '' }) // "a": <hole>
    s.applyViewEdit(setScalar([2, 1], 'zz')) // c -> "zz"   (after)
    s.applyViewEdit(setScalar([1, 1], 222)) // b -> 222     (after)
    expect(s.text).toBe('{\n  "a": ,\n  "b": 222,\n  "c": "zz"\n}')
    // keep typing in the hole across the dirty period
    const hole = s.text.indexOf(',')
    s.applyTextEdit({ from: hole, to: hole, insert: '[' })
    expect(s.state.kind).toBe('dirty')
    s.applyTextEdit({ from: hole + 1, to: hole + 1, insert: ']' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe('{\n  "a": [],\n  "b": 222,\n  "c": "zz"\n}')
    const fresh = EditorSession.fromText(s.text)
    expect(viewEquals(fresh.view!, s.view!)).toBe(true)
    s.checkInvariants()
  })

  it('dirtyLabel points at the broken subtree', () => {
    const s = EditorSession.fromText('{\n  "a": 1,\n  "b": [true, null],\n  "c": 3\n}')
    expect(s.dirtyLabel()).toBeNull()
    const v = s.view!
    const bArr = v.children[1].children[1]
    // break inside the array: delete the comma between true and null
    const off = s.text.indexOf('true,') + 4
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    const dl = s.dirtyLabel()
    // the broken region is attributable to the array (or a node within it)
    const chain: number[] = []
    let cur = v
    let found = dl === bArr.label
    const walk = (n: typeof v): boolean => {
      if (n.label === dl) return true
      return n.children.some(walk)
    }
    found = found || walk(bArr)
    expect(found).toBe(true)
    void chain
    void cur
  })
})
