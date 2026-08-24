/**
 * The generic change-based 'put' (paper Section 4.2):
 *
 *   f_ch e s = s / r ◁ (f_st ∘ ((edit e ∘ f) △ id)) r
 *     where i = mcp ⟨affect e (f s)⟩ ,  r = zoom i s
 *
 * Steps: (i) locate the alignment position r covering the edited view
 * subterm via the labels of the affected view subterm; (ii) apply a
 * state-based put locally at r; (iii) splice the result back into the
 * untouched context. Complexity O(m log n + c·m), m = affected size.
 *
 * Optimization justified by the alignment equation
 * f (s / f r ◁ t) = f s / f r ◁ f t: instead of recomputing `f r` we reuse
 * the cached view subterm with r's label (get copies labels — Lemma 22).
 */

import type { Label, LabelAllocator, LabelRegistry, Path } from './label'
import { labels, zoom } from './term'
import type { Term, TermOps } from './term'
import { plug, replaceAt, subtract } from './context'
import type { EditP } from './edit'
import { relativize } from './edit'
import { mcp } from './mcp'

export interface BxInstance<SD, VD> {
  sOps: TermOps<SD>
  vOps: TermOps<VD>
  get(s: Term<SD>): Term<VD>
  srcReg: LabelRegistry
  viewReg: LabelRegistry
  alloc: LabelAllocator
}

export interface StatePutArgs<SD, VD> {
  editedView: Term<VD>
  oldView: Term<VD>
  oldSource: Term<SD>
  /** root-relative path of the alignment position r in the source */
  sourcePath: Path
}

/** A state-based put for the instance. Postcondition (property-tested):
 * get(result) is label- and value-identical to editedView. */
export type StatePut<SD, VD> = (args: StatePutArgs<SD, VD>) => Term<SD>

export interface PutChResult<SD, VD> {
  source: Term<SD>
  view: Term<VD>
  /** i — path of the alignment position r in the source */
  sourcePath: Path
  /** q — path of r's view counterpart (the spliced view subtree) */
  viewPath: Path
  oldFocus: Term<SD>
  newFocus: Term<SD>
  oldViewFocus: Term<VD>
  newViewFocus: Term<VD>
}

export function putCh<SD, VD>(
  bx: BxInstance<SD, VD>,
  statePut: StatePut<SD, VD>,
  e: EditP<VD>,
  s: Term<SD>,
  v: Term<VD>,
): PutChResult<SD, VD> {
  // (1) affected view subterm u and its labels (evaluated on the ORIGINAL view)
  const affPath = e.affect(e.path, v)
  const u = zoom(v, affPath)
  const ls = labels(u)

  // (2) i = mcp of the source paths of u's labels; r = zoom i s
  const paths: Path[] = []
  for (const l of ls) {
    const p = bx.srcReg.locate(l)
    if (p !== null) paths.push(p)
  }
  if (paths.length === 0) throw new Error('putCh: no view label maps into the source')
  const i = mcp(paths)
  const { ctx, focus: r } = subtract(s, i)

  // (3) view counterpart of r: walk up from r.label to the nearest label
  // present in the view registry (only the Document root is dropped by get).
  let anchor: Label | null = r.label
  while (anchor !== null && !bx.viewReg.has(anchor)) anchor = bx.srcReg.parentOf(anchor)
  const q: Path = anchor === null ? [] : (bx.viewReg.locate(anchor) ?? [])
  const vr = zoom(v, q)

  // (4) apply the edit to the local view, then the state-based put
  const vr2 = e.edit(relativize(e.path, q), vr)
  const r2 = statePut({ editedView: vr2, oldView: vr, oldSource: r, sourcePath: i })

  // (5) splice into the untouched context; update both registries
  const s2 = plug(bx.sOps, ctx, r2)
  const keep = labels(r2)
  bx.srcReg.unmount(r, keep)
  const parentIdx = i.length === 0 ? 0 : i[i.length - 1]
  bx.srcReg.mount(r2, i.length === 0 ? null : zoom(s, i.slice(0, -1)).label, parentIdx)

  const view2 = replaceAt(bx.vOps, v, q, vr2)
  const vkeep = labels(vr2)
  bx.viewReg.unmount(vr, vkeep)
  bx.viewReg.mount(vr2, q.length === 0 ? null : zoom(v, q.slice(0, -1)).label, q.length === 0 ? 0 : q[q.length - 1])

  return {
    source: s2,
    view: view2,
    sourcePath: i,
    viewPath: q,
    oldFocus: r,
    newFocus: r2,
    oldViewFocus: vr,
    newViewFocus: vr2,
  }
}
