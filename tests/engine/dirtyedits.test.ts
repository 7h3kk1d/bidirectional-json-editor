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

  it('dirtySpan covers the broken region; overlap decides locking', () => {
    const s = EditorSession.fromText('{\n  "a": 1,\n  "b": [true, null],\n  "c": 3\n}')
    expect(s.dirtySpan()).toBeNull()
    const v = s.view!
    const bArr = v.children[1].children[1]
    // break inside the array: delete the comma between true and null
    const off = s.text.indexOf('true,') + 4
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    const ds = s.dirtySpan()!
    // the broken region sits inside the array's span...
    const arrSpan = s.spanOfLabel(bArr.label)!
    expect(ds.from).toBeGreaterThanOrEqual(arrSpan.from)
    expect(ds.to).toBeLessThanOrEqual(arrSpan.to)
    // ...and does NOT overlap the sibling members' spans
    for (const idx of [0, 2]) {
      const sib = s.spanOfLabel(v.children[idx].children[1].label)!
      expect(sib.to <= ds.from || sib.from >= ds.to).toBe(true)
    }
  })

  it('deleting a string quote locks only that member chain (user scenario)', () => {
    const text = '{\n  "generated": "2026",\n  "source": "sample",\n  "flags": [true, false]\n}'
    const s = EditorSession.fromText(text)
    const v = s.view!
    // delete the closing quote of "sample"
    const off = text.indexOf('"sample"') + 7
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    const ds = s.dirtySpan()!
    // siblings' spans do not overlap the broken region -> they stay editable
    const genSpan = s.spanOfLabel(v.children[0].children[1].label)!
    const flagsSpan = s.spanOfLabel(v.children[2].children[1].label)!
    expect(genSpan.to <= ds.from || genSpan.from >= ds.to).toBe(true)
    expect(flagsSpan.to <= ds.from || flagsSpan.from >= ds.to).toBe(true)
    // and both really are editable while broken
    s.applyViewEdit(setScalar([0, 1], '2027'))
    s.applyViewEdit(setScalar([2, 1, 0], false))
    expect(s.text).toContain('"generated": "2027"')
    expect(s.text).toContain('[false, false]')
    // the broken member itself is locked
    expect(() => s.applyViewEdit(setScalar([1, 1], 'x'))).toThrow(ViewEditBlockedError)
    // heal
    const healAt = s.text.indexOf('"sample') + 7
    s.applyTextEdit({ from: healAt, to: healAt, insert: '"' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe(
      '{\n  "generated": "2027",\n  "source": "sample",\n  "flags": [false, false]\n}',
    )
    s.checkInvariants()
  })

  it('editing the member right before a deleted comma is allowed (boundary touch)', () => {
    const s = EditorSession.fromText('{"a": 1, "b": 2}')
    const off = s.text.indexOf(',')
    s.applyTextEdit({ from: off, to: off + 1, insert: '' })
    expect(s.state.kind).toBe('dirty')
    // "a"'s value ends exactly where the deleted comma was: touching, not overlapping
    s.applyViewEdit(setScalar([0, 1], 111))
    expect(s.text).toBe('{"a": 111 "b": 2}')
    s.applyTextEdit({ from: s.text.indexOf(' "b"'), to: s.text.indexOf(' "b"'), insert: ',' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe('{"a": 111, "b": 2}')
    s.checkInvariants()
  })
})
