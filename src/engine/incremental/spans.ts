/**
 * Offset <-> path queries over the CST.
 *
 * Spans are stored as LENGTHS on nodes; absolute offsets are computed on
 * demand through per-node child prefix-sum caches held in a WeakMap. After
 * a splice only the (new) spine nodes lack caches — untouched subtrees keep
 * theirs — so there is no O(n) offset shifting per keystroke.
 */

import type { Label, LabelRegistry, Path } from '../core/label'
import { zoom } from '../core/term'
import type { SrcTerm } from '../json/cst'

export interface Span {
  from: number
  to: number
}

const sums = new WeakMap<SrcTerm, number[]>()

/** starts[i] = offset of child i relative to the node; starts[n] = node length. */
function prefixSums(t: SrcTerm): number[] {
  let s = sums.get(t)
  if (!s) {
    s = new Array<number>(t.children.length + 1)
    let acc = 0
    for (let i = 0; i < t.children.length; i++) {
      s[i] = acc
      acc += t.children[i].data.len
    }
    s[t.children.length] = acc
    sums.set(t, s)
  }
  return s
}

export function pathToSpan(root: SrcTerm, p: Path): Span {
  let from = 0
  let cur = root
  for (const i of p) {
    from += prefixSums(cur)[i]
    cur = cur.children[i]
  }
  return { from, to: from + cur.data.len }
}

export function labelToSpan(root: SrcTerm, reg: LabelRegistry, l: Label): Span | null {
  const p = reg.locate(l)
  if (p === null) return null
  return pathToSpan(root, p)
}

/**
 * Path of the deepest node whose span contains `off`.
 * bias 'right' (default): containment is [from, to) — the node starting at
 * `off` wins at boundaries. bias 'left': containment is (from, to].
 */
export function offsetToPath(root: SrcTerm, off: number, bias: 'left' | 'right' = 'right'): Path {
  const path: number[] = []
  let cur = root
  let base = 0
  for (;;) {
    if (cur.children.length === 0) return path
    const s = prefixSums(cur)
    let found = -1
    // binary search for the child whose [start, end) / (start, end] holds off
    let lo = 0
    let hi = cur.children.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const start = base + s[mid]
      const end = base + s[mid + 1]
      const inside = bias === 'right' ? off >= start && off < end : off > start && off <= end
      if (inside) {
        found = mid
        break
      }
      if (off < start || (bias === 'left' && off === start)) hi = mid - 1
      else lo = mid + 1
    }
    if (found === -1) return path
    path.push(found)
    base += s[found]
    cur = cur.children[found]
  }
}

/**
 * Path of the deepest node STRICTLY containing the edit range:
 * span.from < from && to < span.to (paper-plan boundary rule — an edit that
 * touches a node boundary is attributed to the parent, preventing
 * token-joining bugs). For an insertion, from === to.
 */
export function coveringPath(root: SrcTerm, from: number, to: number): Path {
  const path: number[] = []
  let cur = root
  let base = 0
  for (;;) {
    if (cur.children.length === 0) return path
    const s = prefixSums(cur)
    let found = -1
    for (let i = 0; i < cur.children.length; i++) {
      const start = base + s[i]
      const end = base + s[i + 1]
      if (start < from && to < end) {
        found = i
        break
      }
      if (start >= to) break
    }
    if (found === -1) return path
    path.push(found)
    base += s[found]
    cur = cur.children[found]
  }
}

/** Absolute span of the node at `p` plus the node itself. */
export function nodeAtPath(root: SrcTerm, p: Path): { node: SrcTerm; span: Span } {
  return { node: zoom(root, p), span: pathToSpan(root, p) }
}
