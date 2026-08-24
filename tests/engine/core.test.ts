import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LabelAllocator, LabelRegistry } from '../../src/engine/core/label'
import type { Path } from '../../src/engine/core/label'
import { child, labels, zoom } from '../../src/engine/core/term'
import type { Term, TermOps } from '../../src/engine/core/term'
import { plug, replaceAt, spliceList, subtract } from '../../src/engine/core/context'
import { mcp } from '../../src/engine/core/mcp'

// A trivial instance: nodes tagged with a string payload.
type D = string
const ops: TermOps<D> = {
  make: (label, data, children) => ({ label, data, children }),
  equalData: (a, b) => a === b,
}

const arbTree: fc.Arbitrary<Term<D>> = fc.letrec<{ tree: Term<D>; leaf: Term<D> }>((tie) => ({
  leaf: fc.string({ maxLength: 3 }).map((data) => ({ label: 0, data, children: [] })),
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    tie('leaf'),
    fc
      .tuple(fc.string({ maxLength: 3 }), fc.array(tie('tree'), { maxLength: 4 }))
      .map(([data, children]) => ({ label: 0, data, children })),
  ),
})).tree

/** relabel a generated tree with fresh unique labels */
function relabel(t: Term<D>, alloc: LabelAllocator): Term<D> {
  return ops.make(alloc.fresh(), t.data, t.children.map((c) => relabel(c, alloc)))
}

function allPaths(t: Term<D>, prefix: number[] = []): Path[] {
  const out: Path[] = [prefix]
  t.children.forEach((c, i) => out.push(...allPaths(c, [...prefix, i])))
  return out
}

const arbLabelled = arbTree.map((t) => relabel(t, new LabelAllocator()))
const arbTreeAndPath = arbLabelled.chain((t) =>
  fc.constantFrom(...allPaths(t)).map((p) => ({ t, p })),
)

function deepEqual(a: Term<D>, b: Term<D>): boolean {
  return (
    a.label === b.label &&
    a.data === b.data &&
    a.children.length === b.children.length &&
    a.children.every((c, i) => deepEqual(c, b.children[i]))
  )
}

describe('core laws', () => {
  it('plug ∘ subtract = id (Requirement 10 / Corollary 11)', () => {
    fc.assert(
      fc.property(arbTreeAndPath, ({ t, p }) => {
        const { ctx, focus } = subtract(t, p)
        expect(deepEqual(plug(ops, ctx, focus), t)).toBe(true)
      }),
    )
  })

  it('subtract at the empty path yields the empty context (hole equality)', () => {
    fc.assert(
      fc.property(arbLabelled, (t) => {
        const { ctx, focus } = subtract(t, [])
        expect(ctx.length).toBe(0)
        expect(focus).toBe(t)
      }),
    )
  })

  it('zoom(t, locate(l)).label === l for every node', () => {
    fc.assert(
      fc.property(arbLabelled, (t) => {
        const reg = new LabelRegistry()
        reg.mount(t, null, 0)
        for (const l of labels(t)) {
          const p = reg.locate(l)
          expect(p).not.toBeNull()
          expect(zoom(t, p!).label).toBe(l)
        }
      }),
    )
  })

  it('No-Junk: ⟨child t i⟩ ⊂ ⟨t⟩ strictly, and children labelsets are disjoint', () => {
    fc.assert(
      fc.property(arbLabelled, (t) => {
        const all = labels(t)
        for (let i = 0; i < t.children.length; i++) {
          const sub = labels(child(t, i))
          expect(sub.size).toBeLessThan(all.size)
          for (const l of sub) expect(all.has(l)).toBe(true)
        }
        // pairwise disjoint
        const seen = new Set<number>()
        for (const c of t.children) {
          for (const l of labels(c)) {
            expect(seen.has(l)).toBe(false)
            seen.add(l)
          }
        }
      }),
    )
  })

  it('mcp agrees with a naive implementation', () => {
    const arbPaths = fc.array(fc.array(fc.nat({ max: 5 }), { maxLength: 8 }), {
      minLength: 1,
      maxLength: 10,
    })
    const naive = (paths: number[][]): number[] => {
      const out: number[] = []
      for (let i = 0; ; i++) {
        if (paths.some((p) => p.length <= i)) return out
        const v = paths[0][i]
        if (paths.some((p) => p[i] !== v)) return out
        out.push(v)
      }
    }
    fc.assert(
      fc.property(arbPaths, (paths) => {
        expect([...mcp(paths)]).toEqual(naive(paths))
      }),
    )
  })

  it('spliceList replaces one child with a sibling list', () => {
    const alloc = new LabelAllocator()
    const mk = (data: string, children: Term<D>[] = []) => ops.make(alloc.fresh(), data, children)
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    const root = mk('root', [a, b, c])
    const x = mk('x')
    const y = mk('y')
    const out = spliceList(ops, root, [1], [x, y])
    expect(out.children.map((n) => n.data)).toEqual(['a', 'x', 'y', 'c'])
    expect(out.children[0]).toBe(a) // structural sharing
  })

  it('replaceAt at the root returns the replacement', () => {
    fc.assert(
      fc.property(arbLabelled, arbLabelled, (t, u) => {
        expect(replaceAt(ops, t, [], u)).toBe(u)
      }),
    )
  })
})
