/**
 * get — the fold from CST to view (paper Sections 2.1/3.2).
 *
 * Label discipline: every structural CST node's label is COPIED onto its
 * view counterpart; token/trivia labels are dropped, and so is the Document
 * root's (get may drop labels, never invent them — Req. 18). Each case's
 * recursive results appear as subterms of the constructed node, so the fold
 * body is well-aligning (Def. 16): every subterm of the source is an
 * alignment position.
 */

import type { Label, Path } from '../core/label'
import { LabelRegistry } from '../core/label'
import type { SrcTerm } from './cst'
import type { ViewTerm } from './view'
import { viewOps } from './view'
import { replaceAt } from '../core/context'

/** Memo: CST node -> its view. Because terms are immutable, a shared CST
 * subtree (after transferLabels/putSt reuse) yields the SAME view node —
 * the object-identity guarantee the UI's memoized rendering relies on. */
const viewMemo = new WeakMap<SrcTerm, ViewTerm>()

export function getFold(s: SrcTerm): ViewTerm {
  const hit = viewMemo.get(s)
  if (hit) return hit
  const v = getFoldUncached(s)
  viewMemo.set(s, v)
  return v
}

function getFoldUncached(s: SrcTerm): ViewTerm {
  const d = s.data
  switch (d.kind) {
    case 'Document': {
      const v = s.children.find((c) => c.data.kind !== 'Trivia')
      if (!v) throw new Error('get: empty document')
      return getFold(v)
    }
    case 'Object':
      return {
        label: s.label,
        data: { kind: 'VObject' },
        children: s.children.filter((c) => c.data.kind === 'Member').map(getFold),
      }
    case 'Array':
      return {
        label: s.label,
        data: { kind: 'VArray' },
        children: s.children.filter((c) => !isTokenKind(c)).map(getFold),
      }
    case 'Member': {
      const key = s.children[0]
      if (key.data.kind !== 'StringLit') throw new Error('get: malformed member')
      const value = s.children[s.children.length - 1]
      const keyView: ViewTerm = {
        label: key.label,
        data: { kind: 'VString', value: key.data.value },
        children: [],
      }
      return { label: s.label, data: { kind: 'VMember' }, children: [keyView, getFold(value)] }
    }
    case 'StringLit':
      return { label: s.label, data: { kind: 'VString', value: d.value }, children: [] }
    case 'NumberLit':
      return { label: s.label, data: { kind: 'VNumber', value: d.value }, children: [] }
    case 'BoolLit':
      return { label: s.label, data: { kind: 'VBool', value: d.value }, children: [] }
    case 'NullLit':
      return { label: s.label, data: { kind: 'VNull' }, children: [] }
    default:
      throw new Error(`get: no view for token kind ${d.kind}`)
  }
}

function isTokenKind(t: SrcTerm): boolean {
  return t.data.kind === 'Punct' || t.data.kind === 'Trivia'
}

export function buildRegistries(
  s: SrcTerm,
  v: ViewTerm,
): { srcReg: LabelRegistry; viewReg: LabelRegistry } {
  const srcReg = new LabelRegistry()
  srcReg.mount(s, null, 0)
  const viewReg = new LabelRegistry()
  viewReg.mount(v, null, 0)
  return { srcReg, viewReg }
}

/** Replace the view subtree at `p` (spine rebuild, structural sharing). */
export function spliceView(v: ViewTerm, p: Path, sub: ViewTerm): ViewTerm {
  return replaceAt(viewOps, v, p, sub)
}

/** Labels of view nodes along a root path, outermost first. */
export function viewLabelsAlong(v: ViewTerm, p: Path): Label[] {
  const out: Label[] = [v.label]
  let cur = v
  for (const i of p) {
    cur = cur.children[i]
    out.push(cur.label)
  }
  return out
}
