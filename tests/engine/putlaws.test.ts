import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EditorSession } from '../../src/engine/session'
import { identityEdit } from '../../src/engine/core/edit'
import type { EditP } from '../../src/engine/core/edit'
import type { Path } from '../../src/engine/core/label'
import type { VData, ViewTerm } from '../../src/engine/json/view'
import { viewEquals } from '../../src/engine/json/view'
import {
  deleteChild,
  insertChild,
  moveChild,
  renameKey,
  replaceValue,
  setScalar,
} from '../../src/engine/json/edits'
import { arbFormattedText } from './arbitraries'

/** enumerate (path, node) pairs of a view; keySlot marks member key slots */
function nodesOf(
  v: ViewTerm,
  p: number[] = [],
  keySlot = false,
): { path: Path; node: ViewTerm; keySlot: boolean }[] {
  const out: { path: Path; node: ViewTerm; keySlot: boolean }[] = [{ path: p, node: v, keySlot }]
  v.children.forEach((c, i) =>
    out.push(...nodesOf(c, [...p, i], v.data.kind === 'VMember' && i === 0)),
  )
  return out
}

/** Data description of a view edit; constructed against the APPLYING
 * session's allocator inside the property (a closure capturing another
 * session's allocator would create label collisions no real caller can). */
type EditDesc =
  | { type: 'setScalar'; path: Path; value: string | number | boolean | null }
  | { type: 'replaceValue'; path: Path; spec: unknown }
  | { type: 'renameKey'; path: Path; key: string }
  | { type: 'insertObj'; path: Path; index: number; key: string; value: unknown }
  | { type: 'insertArr'; path: Path; index: number; item: unknown }
  | { type: 'delete'; path: Path; index: number }
  | { type: 'move'; path: Path; from: number; to: number }

function buildEdit(d: EditDesc, s: EditorSession): EditP<VData> {
  switch (d.type) {
    case 'setScalar':
      return setScalar(d.path, d.value)
    case 'replaceValue':
      return replaceValue(d.path, d.spec, s.freshLabels())
    case 'renameKey':
      return renameKey(d.path, d.key)
    case 'insertObj':
      return insertChild(d.path, d.index, { key: d.key, value: d.value }, s.freshLabels())
    case 'insertArr':
      return insertChild(d.path, d.index, { item: d.item }, s.freshLabels())
    case 'delete':
      return deleteChild(d.path, d.index)
    case 'move':
      return moveChild(d.path, d.from, d.to)
  }
}

/** a random valid edit description for the given session */
function arbViewEditFor(s: EditorSession): fc.Arbitrary<EditDesc> | null {
  const v = s.view
  if (!v) return null
  const all = nodesOf(v)
  const scalars = all.filter(
    (n) =>
      !n.keySlot && ['VString', 'VNumber', 'VBool', 'VNull'].includes(n.node.data.kind),
  )
  const containers = all.filter((n) => ['VObject', 'VArray'].includes(n.node.data.kind))
  const members = all.filter((n) => n.node.data.kind === 'VMember')
  const values = all.filter((n) => !n.keySlot && n.node.data.kind !== 'VMember')

  const arbScalarValue = fc.oneof(
    fc.string({ maxLength: 8 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
  )
  const arbPlain: fc.Arbitrary<unknown> = fc.oneof(
    arbScalarValue,
    fc.constant([1, 'two', false]),
    fc.constant({ nested: { deep: [] } }),
    fc.constant([]),
    fc.constant({}),
  )

  const options: fc.Arbitrary<EditDesc>[] = []
  if (scalars.length > 0) {
    options.push(
      fc
        .tuple(fc.constantFrom(...scalars), arbScalarValue)
        .map(([n, value]) => ({ type: 'setScalar', path: n.path, value }) as EditDesc),
    )
  }
  if (values.length > 0) {
    options.push(
      fc
        .tuple(fc.constantFrom(...values), arbPlain)
        .map(([n, spec]) => ({ type: 'replaceValue', path: n.path, spec }) as EditDesc),
    )
  }
  if (members.length > 0) {
    options.push(
      fc
        .tuple(fc.constantFrom(...members), fc.string({ maxLength: 6 }))
        .map(([n, key]) => ({ type: 'renameKey', path: n.path, key }) as EditDesc),
    )
  }
  if (containers.length > 0) {
    options.push(
      fc
        .tuple(fc.constantFrom(...containers), fc.nat({ max: 8 }), arbPlain, fc.string({ maxLength: 5 }))
        .map(([n, idx, value, key]) => {
          const index = Math.min(idx, n.node.children.length)
          return n.node.data.kind === 'VObject'
            ? ({ type: 'insertObj', path: n.path, index, key, value } as EditDesc)
            : ({ type: 'insertArr', path: n.path, index, item: value } as EditDesc)
        }),
    )
    const nonEmpty = containers.filter((c) => c.node.children.length > 0)
    if (nonEmpty.length > 0) {
      options.push(
        fc
          .tuple(fc.constantFrom(...nonEmpty), fc.nat({ max: 32 }))
          .map(
            ([n, idx]) =>
              ({ type: 'delete', path: n.path, index: idx % n.node.children.length }) as EditDesc,
          ),
      )
    }
    const movable = containers.filter((c) => c.node.children.length >= 2)
    if (movable.length > 0) {
      options.push(
        fc.tuple(fc.constantFrom(...movable), fc.nat({ max: 32 }), fc.nat({ max: 32 })).map(
          ([n, a, b]) =>
            ({
              type: 'move',
              path: n.path,
              from: a % n.node.children.length,
              to: b % n.node.children.length,
            }) as EditDesc,
        ),
      )
    }
  }
  if (options.length === 0) return null
  return fc.oneof(...options)
}

describe('bidirectional laws (paper Theorems 24-26 territory)', () => {
  it('Consistency: view after putCh equals the edit applied to the old view; text reparses to it', () => {
    fc.assert(
      fc.property(
        arbFormattedText.chain((text) => {
          const probe = EditorSession.fromText(text)
          if (probe.state.kind !== 'clean') return fc.constant(null)
          const arb = arbViewEditFor(probe)
          if (!arb) return fc.constant(null)
          return arb.map((desc) => ({ text, desc }))
        }),
        (input) => {
          if (input === null) return
          const { text, desc } = input
          const s = EditorSession.fromText(text)
          const e = buildEdit(desc, s)
          const v0 = s.view!
          const expected = e.edit(e.path, v0)
          s.applyViewEdit(e)
          expect(viewEquals(s.view!, expected)).toBe(true)
          s.checkInvariants()
          // the produced text parses back to exactly this view (get ∘ put)
          const reparsed = EditorSession.fromText(s.text)
          expect(reparsed.state.kind).toBe('clean')
          expect(viewEquals(reparsed.view!, s.view!)).toBe(true)
        },
      ),
      { numRuns: 250 },
    )
  })

  it('Acceptability: the identity edit leaves the text byte-identical', () => {
    fc.assert(
      fc.property(arbFormattedText, (text) => {
        const s = EditorSession.fromText(text)
        if (s.state.kind !== 'clean') return
        const r = s.applyViewEdit(identityEdit())
        expect(r.textEdit).toBeNull()
        expect(s.text).toBe(text)
      }),
      { numRuns: 100 },
    )
  })

  it('Locality: text outside the alignment span is byte-identical; sibling view nodes keep identity', () => {
    const text = '{\n  "a": 1,\n  "b": [true, null],\n  "c": "hi"\n}'
    const s = EditorSession.fromText(text)
    const v0 = s.view!
    // edit "a"'s value
    const r = s.applyViewEdit(setScalar([0, 1], 42))
    expect(r.textEdit).not.toBeNull()
    const { from, to } = r.textEdit!
    expect(s.text.slice(0, from)).toBe(text.slice(0, from))
    expect(s.text.slice(from + r.textEdit!.insert.length)).toBe(text.slice(to))
    // sibling members untouched: same object identity
    expect(s.view!.children[1]).toBe(v0.children[1])
    expect(s.view!.children[2]).toBe(v0.children[2])
    expect(s.view!.children.map((m) => m.label)).toEqual(v0.children.map((m) => m.label))
  })
})

describe('formatting preservation (golden)', () => {
  const mk = (text: string) => EditorSession.fromText(text)

  it('setScalar rewrites just the lexeme', () => {
    const s = mk('{\n  "a": 1,\n  "b": 2\n}')
    s.applyViewEdit(setScalar([0, 1], 42))
    expect(s.text).toBe('{\n  "a": 42,\n  "b": 2\n}')
  })

  it('insert into a multiline object clones sibling indentation', () => {
    const s = mk('{\n  "a": 1,\n  "b": 2\n}')
    s.applyViewEdit(insertChild([], 2, { key: 'c', value: 3 }, s.freshLabels()))
    expect(s.text).toBe('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}')
  })

  it('insert into an inline array keeps it inline', () => {
    const s = mk('[1, 2, 3]')
    s.applyViewEdit(insertChild([], 2, { item: 9 }, s.freshLabels()))
    expect(s.text).toBe('[1, 2, 9, 3]')
  })

  it('delete cleans up exactly one comma', () => {
    const s = mk('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}')
    s.applyViewEdit(deleteChild([], 1))
    expect(s.text).toBe('{\n  "a": 1,\n  "c": 3\n}')
  })

  it('delete the last member collapses to {}', () => {
    const s = mk('{ "only": true }')
    s.applyViewEdit(deleteChild([], 0))
    expect(s.text).toBe('{}')
  })

  it('insert first member into an empty object', () => {
    const s = mk('{}')
    s.applyViewEdit(insertChild([], 0, { key: 'k', value: 1 }, s.freshLabels()))
    expect(s.text).toBe('{"k": 1}')
  })

  it('renameKey rewrites only the key lexeme', () => {
    const s = mk('{ "old" : 7 }')
    s.applyViewEdit(renameKey([0], 'new'))
    expect(s.text).toBe('{ "new" : 7 }')
  })

  it('replaceValue string -> array in place', () => {
    const s = mk('{ "x": "hi", "y": 0 }')
    s.applyViewEdit(replaceValue([0, 1], [1, 2], s.freshLabels()))
    expect(s.text).toBe('{ "x": [1, 2], "y": 0 }')
  })

  it('exotic number lexemes survive edits elsewhere', () => {
    const s = mk('[1e3, 1.0, 2]')
    s.applyViewEdit(setScalar([2], 99))
    expect(s.text).toBe('[1e3, 1.0, 99]')
  })

  it('move keeps per-item formatting', () => {
    const s = mk('{\n  "a": 1,\n  "b": 2\n}')
    s.applyViewEdit(moveChild([], 0, 1))
    expect(s.text).toBe('{\n  "b": 2,\n  "a": 1\n}')
  })
})

describe('dirty protocol', () => {
  it('freezes the view, keeps disjoint edits live, recovers', () => {
    const s = EditorSession.fromText('{"a": 1}')
    const v0 = s.view!
    // delete the closing brace
    s.applyTextEdit({ from: 7, to: 8, insert: '' })
    expect(s.state.kind).toBe('dirty')
    expect(s.view).toBe(v0)
    expect(s.parseError()).not.toBeNull()
    // span queries remap through pending edits
    const span = s.spanOfLabel(v0.children[0].children[1].label)
    expect(span).toEqual({ from: 6, to: 7 })
    // "a"'s value only touches the broken region (the missing brace), so the
    // localized dirty protocol lets the edit through
    s.applyViewEdit(setScalar([0, 1], 2))
    expect(s.text).toBe('{"a": 2')
    // type the brace back
    s.applyTextEdit({ from: 7, to: 7, insert: '}' })
    expect(s.state.kind).toBe('clean')
    expect(s.text).toBe('{"a": 2}')
    expect(s.view!.children[0].children[1].data).toMatchObject({ kind: 'VNumber', value: 2 })
    s.checkInvariants()
  })

  it('empty document round trip', () => {
    const s = EditorSession.fromText('')
    expect(s.state.kind).toBe('empty')
    s.applyTextEdit({ from: 0, to: 0, insert: '{"a": 1}' })
    expect(s.state.kind).toBe('clean')
    expect(s.view).not.toBeNull()
    s.applyTextEdit({ from: 0, to: 8, insert: '' })
    expect(s.state.kind).toBe('empty')
    expect(s.view).toBeNull()
  })
})

describe('interleaved text and view edits (fuzz)', () => {
  it('random mixes keep every invariant', () => {
    fc.assert(
      fc.property(arbFormattedText, fc.array(fc.nat(), { minLength: 2, maxLength: 8 }), (text, seeds) => {
        const s = EditorSession.fromText(text)
        if (s.state.kind !== 'clean') return
        let rng = seeds.reduce((a, b) => (a * 31 + b) & 0x7fffffff, 7)
        const next = (n: number) => {
          rng = (rng * 1103515245 + 12345) & 0x7fffffff
          return rng % n
        }
        for (const _ of seeds) {
          if (s.state.kind === 'clean' && s.view && next(2) === 0) {
            // view edit: random scalar set
            const scalars = nodesOf(s.view).filter(
              (n) =>
                !n.keySlot && ['VString', 'VNumber', 'VBool', 'VNull'].includes(n.node.data.kind),
            )
            if (scalars.length > 0) {
              const n = scalars[next(scalars.length)]
              s.applyViewEdit(setScalar(n.path, next(1000)))
            }
          } else {
            const from = next(s.text.length + 1)
            const to = Math.min(s.text.length, from + next(3))
            const inserts = ['', ' ', '1', '"q"', ',', 'true']
            s.applyTextEdit({ from, to, insert: inserts[next(inserts.length)] })
          }
          s.checkInvariants()
          if (s.state.kind === 'clean' && s.view) {
            const fresh = EditorSession.fromText(s.text)
            expect(fresh.state.kind).toBe('clean')
            expect(viewEquals(fresh.view!, s.view)).toBe(true)
          }
        }
      }),
      { numRuns: 150 },
    )
  })
})
