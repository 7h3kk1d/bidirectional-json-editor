/**
 * One-hole contexts (paper Section 2.4).
 *
 * Delta<D> is the one-hole context of a single node: the node's label and
 * payload plus the children to the left and right of the hole. A Context is
 * a list of Deltas, outermost first; `plug` (the paper's ◁) is a right fold
 * of `close`, and `subtract` computes `t / zoom(t, p)`.
 */

import type { Path } from './label'
import type { Term, TermOps } from './term'

export interface Delta<D> {
  readonly label: Term<D>['label']
  readonly data: D
  readonly left: readonly Term<D>[]
  readonly right: readonly Term<D>[]
}

export type Context<D> = readonly Delta<D>[]

/** close — wrap one Delta around a filler term. */
export function close<D>(ops: TermOps<D>, d: Delta<D>, hole: Term<D>): Term<D> {
  return ops.make(d.label, d.data, [...d.left, hole, ...d.right])
}

/** ◁ — close a whole context around a term (right fold of close). */
export function plug<D>(ops: TermOps<D>, ctx: Context<D>, t: Term<D>): Term<D> {
  let cur = t
  for (let i = ctx.length - 1; i >= 0; i--) cur = close(ops, ctx[i], cur)
  return cur
}

/** t / zoom(t, p) — split a term into the context along `p` and the focus. */
export function subtract<D>(t: Term<D>, p: Path): { ctx: Context<D>; focus: Term<D> } {
  const ctx: Delta<D>[] = []
  let cur = t
  for (const i of p) {
    const kids = cur.children
    if (i < 0 || i >= kids.length) {
      throw new Error(`subtract: index ${i} out of range (arity ${kids.length})`)
    }
    ctx.push({ label: cur.label, data: cur.data, left: kids.slice(0, i), right: kids.slice(i + 1) })
    cur = kids[i]
  }
  return { ctx, focus: cur }
}

/**
 * Generalized splice: replace the child at the end of `p` with a LIST of
 * siblings (used by incremental reparse, where a fragment may come back as
 * [Trivia?, node, Trivia?]). `p` must be non-empty.
 */
export function spliceList<D>(
  ops: TermOps<D>,
  t: Term<D>,
  p: Path,
  replacement: readonly Term<D>[],
): Term<D> {
  if (p.length === 0) throw new Error('spliceList: empty path (replace the root directly instead)')
  const { ctx } = subtract(t, p)
  const last = ctx[ctx.length - 1]
  const rebuilt = ops.make(last.label, last.data, [...last.left, ...replacement, ...last.right])
  return plug(ops, ctx.slice(0, -1), rebuilt)
}

/** Replace the subterm at `p` with `sub` (spine rebuild, structural sharing). */
export function replaceAt<D>(ops: TermOps<D>, t: Term<D>, p: Path, sub: Term<D>): Term<D> {
  if (p.length === 0) return sub
  const { ctx } = subtract(t, p)
  return plug(ops, ctx, sub)
}
