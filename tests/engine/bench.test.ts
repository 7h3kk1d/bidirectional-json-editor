/**
 * Perf smoke over a ~1MB document (bounds deliberately generous — this is a
 * regression tripwire, not a benchmark).
 */
import { describe, expect, it } from 'vitest'
import { EditorSession } from '../../src/engine/session'
import { setScalar } from '../../src/engine/json/edits'

function bigDoc(): string {
  const items: string[] = []
  for (let i = 0; i < 8000; i++) {
    items.push(
      `    { "id": ${i}, "name": "item-${i}", "active": ${i % 3 === 0}, "score": ${(i * 7919) % 1000}, "tags": ["a", "b"] }`,
    )
  }
  return `{\n  "items": [\n${items.join(',\n')}\n  ]\n}\n`
}

describe('1MB-class document', () => {
  const text = bigDoc()

  it(`full parse is fast enough (${(text.length / 1024).toFixed(0)}KB)`, () => {
    const t0 = performance.now()
    const s = EditorSession.fromText(text)
    const ms = performance.now() - t0
    expect(s.state.kind).toBe('clean')
    expect(ms).toBeLessThan(2000)
  })

  it('keystroke update and queries are incremental', () => {
    const s = EditorSession.fromText(text)
    const off = text.indexOf('"score": ') + 9
    // warm up caches along the path
    s.labelPathAtOffset(off)
    let t0 = performance.now()
    s.applyTextEdit({ from: off, to: off, insert: '1' })
    const editMs = performance.now() - t0
    expect(s.state.kind).toBe('clean')
    expect(editMs).toBeLessThan(100)

    t0 = performance.now()
    const path = s.labelPathAtOffset(off)
    const queryMs = performance.now() - t0
    expect(path.length).toBeGreaterThan(0)
    expect(queryMs).toBeLessThan(20)

    // a view edit deep in the array is local
    const label = path[path.length - 1]
    const vp = s.viewPathOfLabel(label)!
    t0 = performance.now()
    s.applyViewEdit(setScalar(vp, 123))
    const putMs = performance.now() - t0
    expect(putMs).toBeLessThan(100)
    expect(s.state.kind).toBe('clean')
  })
})
