/**
 * Terms — the paper's `Term s a = InT (s a (Term s a))` (Section 2.1),
 * encoded pragmatically: every node is a labelled record whose `children`
 * array holds exactly the recursive positions (the functor's second slot),
 * and `data` holds the element payload / constructor tag (the first slot).
 *
 * The paper's TypeFunctor operations become:
 *   arity t   = t.children.length
 *   select t i = child(t, i)
 *   lab       = every node contributes its own label; `labels` is `fold lab`
 *   bimap     = subsumed by structural recursion
 */

import type { Label, LabelSet, Path } from './label'

export interface Term<D> {
  readonly label: Label
  readonly data: D
  readonly children: readonly Term<D>[]
}

/** Per-instance vtable: smart constructor (maintains derived data such as
 * source lengths) and payload equality. */
export interface TermOps<D> {
  make(label: Label, data: D, children: readonly Term<D>[]): Term<D>
  equalData(a: D, b: D): boolean
}

/** fold — consumes a term bottom-up. */
export function fold<D, R>(t: Term<D>, alg: (t: Term<D>, kids: readonly R[]) => R): R {
  const kids = t.children.map((c) => fold(c, alg))
  return alg(t, kids)
}

/** ⟨t⟩ — the labelset of a term (paper Section 2.3). */
export function labels<D>(t: Term<D>, into?: Set<Label>): LabelSet {
  const acc = into ?? new Set<Label>()
  acc.add(t.label)
  for (const c of t.children) labels(c, acc)
  return acc
}

/** (outT t)_i */
export function child<D>(t: Term<D>, i: number): Term<D> {
  const c = t.children[i]
  if (!c) throw new Error(`child: index ${i} out of range (arity ${t.children.length})`)
  return c
}

/** zoom — select an arbitrarily deep subterm by path (paper Section 2.2). */
export function zoom<D>(t: Term<D>, p: Path): Term<D> {
  let cur = t
  for (const i of p) cur = child(cur, i)
  return cur
}
