/**
 * Direction 2 — a text edit becomes a LOCAL update of the CST and view:
 * find the smallest node strictly containing the edit, widen to the nearest
 * reparsable kind, reparse just that region, transfer labels, splice, and
 * incrementally re-run `get` on the affected subtree only. The validity of
 * treating the surrounding context as untouched is the alignment property
 * of the well-aligning `get` (paper Theorems 17/23).
 */

import type { LabelAllocator, LabelRegistry, Path } from '../core/label'
import { labels, zoom } from '../core/term'
import { replaceAt } from '../core/context'
import type { SrcTerm } from '../json/cst'
import { mkTrivia, srcOps } from '../json/cst'
import type { ViewTerm } from '../json/view'
import { viewIdentical } from '../json/view'
import { getFold, spliceView } from '../json/get'
import { parse } from '../json/parser'
import type { Entry } from '../json/parser'
import { transferLabels } from '../json/relabel'
import type { TextEdit } from './changeset'
import { deltaOf } from './changeset'
import { coveringPath, pathToSpan } from './spans'

export interface ViewPatch {
  path: Path
  oldNode: ViewTerm
  newNode: ViewTerm
}

export type ReparseResult =
  | { ok: true; cst: SrcTerm; view: ViewTerm; viewPatch: ViewPatch | null }
  | { ok: false; error: { pos: number; expected: string } }

export function applyTextEditToCst(args: {
  cst: SrcTerm
  newText: string
  edit: TextEdit // coordinates in the OLD text
  alloc: LabelAllocator
  srcReg: LabelRegistry
  viewReg: LabelRegistry
  view: ViewTerm
}): ReparseResult {
  const { cst, newText, edit, alloc } = args
  const delta = deltaOf(edit)

  // -- whitespace fast path: the edit stays inside one Trivia token ---------
  const fast = tryTriviaFastPath(args)
  if (fast) return fast

  // -- general path: covering node, widen to a reparsable entry -------------
  let p = coveringPath(cst, edit.from, edit.to)
  let lastError: { pos: number; expected: string } | null = null
  for (;;) {
    // widen to a node kind that has a parse entry
    let entry: Entry | null = null
    for (;;) {
      const kind = zoom(cst, p).data.kind
      if (kind === 'Member') entry = 'memberFragment'
      else if (kind === 'Document') entry = 'document'
      else if (kind === 'Punct' || kind === 'Trivia') entry = null
      else entry = 'valueFragment'
      if (entry !== null) break
      p = p.slice(0, -1)
    }

    const oldNode = zoom(cst, p)
    const span = pathToSpan(cst, p)
    const region = newText.slice(span.from, span.to + delta)
    const r = parse(region, entry, alloc)

    if (r.ok && r.consumed === region.length) {
      return commit(args, p, oldNode, r.terms)
    }
    if (!r.ok) lastError = { pos: span.from + r.pos, expected: r.expected }
    else
      lastError = {
        pos: span.from + r.consumed,
        expected: p.length === 0 ? 'end of input' : 'end of region',
      }
    if (p.length === 0) return { ok: false, error: lastError }
    p = p.slice(0, -1)
  }
}

// --------------------------------------------------------------------------

function tryTriviaFastPath(args: {
  cst: SrcTerm
  newText: string
  edit: TextEdit
  alloc: LabelAllocator
  srcReg: LabelRegistry
  viewReg: LabelRegistry
  view: ViewTerm
}): ReparseResult | null {
  const { cst, edit, view } = args
  if (!/^[ \t\r\n]*$/.test(edit.insert)) return null
  // find a trivia node with span.from <= from && to <= span.to
  const found = findTrivia(cst, edit.from, edit.to)
  if (!found) return null
  const { path, span, node } = found
  const oldText = node.data.kind === 'Trivia' ? node.data.text : ''
  const newTriviaText =
    oldText.slice(0, edit.from - span.from) + edit.insert + oldText.slice(edit.to - span.from)
  const parentPath = path.slice(0, -1)
  const parent = zoom(cst, parentPath)
  const idx = path[path.length - 1]
  const replacement =
    newTriviaText.length === 0 ? [] : [mkTrivia(node.label, newTriviaText)]
  const newChildren = [
    ...parent.children.slice(0, idx),
    ...replacement,
    ...parent.children.slice(idx + 1),
  ]
  const newParent = srcOps.make(parent.label, parent.data, newChildren)
  const cst2 = replaceAt(srcOps, cst, parentPath, newParent)
  // registry: parent's subtree entries stay valid except the trivia + indices
  // registry: subtree entries below the parent stay valid; refresh the
  // (possibly shifted) direct-child indices, dropping the trivia if removed
  if (newTriviaText.length === 0) args.srcReg.unmount(node)
  args.srcReg.reindexChildren(newParent)
  return { ok: true, cst: cst2, view, viewPatch: null }
}

function findTrivia(
  cst: SrcTerm,
  from: number,
  to: number,
): { path: Path; span: { from: number; to: number }; node: SrcTerm } | null {
  const path: number[] = []
  let cur = cst
  let base = 0
  for (;;) {
    if (cur.data.kind === 'Trivia') {
      return { path, span: { from: base, to: base + cur.data.len }, node: cur }
    }
    if (cur.children.length === 0) return null
    // candidates: children whose [start, end] contains [from, to] non-strictly.
    // At most two (only for a boundary insertion); prefer a Trivia child.
    let chosen = -1
    let chosenStart = 0
    let acc = base
    for (let i = 0; i < cur.children.length; i++) {
      const start = acc
      const end = acc + cur.children[i].data.len
      if (start <= from && to <= end) {
        if (cur.children[i].data.kind === 'Trivia') {
          chosen = i
          chosenStart = start
          break
        }
        if (chosen === -1) {
          chosen = i
          chosenStart = start
        }
      }
      if (start > to) break
      acc = end
    }
    if (chosen === -1) return null
    path.push(chosen)
    base = chosenStart
    cur = cur.children[chosen]
  }
}

function commit(
  args: {
    cst: SrcTerm
    alloc: LabelAllocator
    srcReg: LabelRegistry
    viewReg: LabelRegistry
    view: ViewTerm
  },
  p: Path,
  oldNode: SrcTerm,
  parsedTerms: readonly SrcTerm[],
): ReparseResult {
  const { cst, srcReg, viewReg, view } = args

  // label transfer: pair the old principal node with the new one
  const principalIdx = parsedTerms.findIndex((t) => t.data.kind !== 'Trivia')
  const newSubs = parsedTerms.map((t, k) =>
    k === principalIdx ? transferLabels(oldNode, t) : t,
  )
  const principal = newSubs[principalIdx]

  // locate the view counterpart BEFORE registries change
  const viewAnchor = viewReg.locate(oldNode.label)

  let cst2: SrcTerm
  if (p.length === 0) {
    // whole-document reparse
    cst2 = principal
    srcReg.unmount(cst, labels(cst2))
    srcReg.mount(cst2, null, 0)
  } else {
    const parentPath = p.slice(0, -1)
    const parent = zoom(cst, parentPath)
    const idx = p[p.length - 1]
    const merged = mergeAdjacentTrivia(
      [...parent.children.slice(0, idx), ...newSubs, ...parent.children.slice(idx + 1)],
    )
    const newParent = srcOps.make(parent.label, parent.data, merged)
    cst2 = replaceAt(srcOps, cst, parentPath, newParent)
    // registry: swap the parent subtree wholesale (cost O(|parent subtree|),
    // which is O(region + siblings) for typical edits)
    const grandLabel = parentPath.length === 0 ? null : zoom(cst, parentPath.slice(0, -1)).label
    const parentIdx = parentPath.length === 0 ? 0 : parentPath[parentPath.length - 1]
    srcReg.unmount(parent, labels(newParent))
    srcReg.mount(newParent, grandLabel, parentIdx)
  }

  // incremental re-get of the affected subtree
  if (principal.data.kind === 'Document') {
    const vNew = getFold(principal)
    if (viewIdentical(view, vNew)) {
      return { ok: true, cst: cst2, view, viewPatch: null }
    }
    viewReg.unmount(view, labels(vNew))
    viewReg.mount(vNew, null, 0)
    return { ok: true, cst: cst2, view: vNew, viewPatch: { path: [], oldNode: view, newNode: vNew } }
  }

  if (viewAnchor === null) {
    throw new Error('reparse: covering node has no view counterpart')
  }
  const oldViewSub = zoom(view, viewAnchor)
  const vNew = getFold(principal)
  if (viewIdentical(oldViewSub, vNew)) {
    return { ok: true, cst: cst2, view, viewPatch: null }
  }
  const view2 = spliceView(view, viewAnchor, vNew)
  const viewParent = viewAnchor.length === 0 ? null : zoom(view, viewAnchor.slice(0, -1)).label
  viewReg.unmount(oldViewSub, labels(vNew))
  viewReg.mount(vNew, viewParent, viewAnchor.length === 0 ? 0 : viewAnchor[viewAnchor.length - 1])
  return {
    ok: true,
    cst: cst2,
    view: view2,
    viewPatch: { path: viewAnchor, oldNode: oldViewSub, newNode: vNew },
  }
}

/** Maintain the no-adjacent-trivia invariant after a splice. */
function mergeAdjacentTrivia(children: readonly SrcTerm[]): SrcTerm[] {
  const out: SrcTerm[] = []
  for (const c of children) {
    const prev = out[out.length - 1]
    if (prev && prev.data.kind === 'Trivia' && c.data.kind === 'Trivia') {
      out[out.length - 1] = mkTrivia(prev.label, prev.data.text + c.data.text)
    } else if (c.data.kind === 'Trivia' && c.data.text.length === 0) {
      // drop empty trivia defensively
    } else {
      out.push(c)
    }
  }
  return out
}
