import { describe, expect, it } from 'vitest'
import { SessionEngine } from '../../src/engine'
import { flatten } from '../../src/ui/tree/flatten'
import { jsonPathOf, pathSegments } from '../../src/ui/lib/paths'

const SAMPLE = '{"users": [{"name": "Ada", "odd key": 1}], "n": 2}'

describe('flatten', () => {
  it('emits DFS rows and collapse hides subtrees', () => {
    const engine = new SessionEngine(SAMPLE)
    const view = engine.getView()!
    const rows = flatten(view, new Set())
    expect(rows.map((r) => r.kind)).toEqual(['object', 'array', 'object', 'string', 'number', 'number'])
    expect(rows[1].key).toBe('users')
    expect(rows[3].depth).toBe(3)
    if (view.kind !== 'object') throw new Error('bad')
    const usersLabel = view.entries[0].value.label
    const collapsedRows = flatten(view, new Set([usersLabel]))
    expect(collapsedRows.length).toBe(3)
    expect(collapsedRows[1].childCount).toBe(1)
  })

  it('row identity is stable across unrelated edits (memo-friendly)', () => {
    const text = '{\n  "a": 1,\n  "b": {"deep": true}\n}'
    const engine = new SessionEngine(text)
    const v1 = engine.getView()!
    const off = text.indexOf('1')
    const r = engine.applyTextEdit([{ from: off, to: off + 1, insert: '7' }])
    const v2 = r.view!
    if (v1.kind !== 'object' || v2.kind !== 'object') throw new Error('bad')
    expect(v2.entries[1].value).toBe(v1.entries[1].value) // object identity kept
  })
})

describe('paths', () => {
  it('renders JSONPath with bracket escapes for odd keys', () => {
    const engine = new SessionEngine(SAMPLE)
    const view = engine.getView()!
    if (view.kind !== 'object') throw new Error('bad')
    const users = view.entries[0].value
    if (users.kind !== 'array') throw new Error('bad')
    const first = users.items[0]
    if (first.kind !== 'object') throw new Error('bad')
    const odd = first.entries[1]
    const labels = [view.label, users.label, first.label, odd.value.label]
    expect(jsonPathOf(view, labels)).toBe('$.users[0]["odd key"]')
    expect(pathSegments(view, labels).map((s) => s.text)).toEqual(['$', '.users', '[0]', '["odd key"]'])
  })
})
