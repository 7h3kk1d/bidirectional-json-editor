/**
 * The JSON state-based put — the fˢᵗ that the change-based putᶜʰ applies
 * LOCALLY at the alignment position (paper Section 4.2 step ii).
 *
 * Reuse discipline (what makes labels stable and formatting sticky):
 *  1. reference-equal view subtree  -> return the old CST node unchanged;
 *  2. same label & kind             -> keep this node's tokens, recurse,
 *     matching container children by label; new children clone separator
 *     formatting from the nearest reused sibling or synthesize from the
 *     FormatContext; deletions drop exactly one adjacent comma + trivia;
 *  3. label/kind changed            -> generate fresh CST carrying the VIEW
 *     labels (so `get` of the result reproduces the edited view exactly).
 *
 * Postcondition (property-tested): get(result) is label- and value-identical
 * to editedView.
 */

import type { LabelAllocator } from '../core/label'
import type { SrcTerm } from './cst'
import {
  encodeString,
  mkBoolLit,
  mkNullLit,
  mkNumberLit,
  mkPunct,
  mkStringLit,
  mkTrivia,
  srcOps,
} from './cst'
import type { ViewTerm, VKind } from './view'
import type { SKind } from './cst'
import type { FormatContext } from './format'
import { render } from './render'

export interface JsonPutArgs {
  editedView: ViewTerm
  oldView: ViewTerm
  oldSource: SrcTerm
  fmt: FormatContext
  alloc: LabelAllocator
  /** leading whitespace of the line where oldSource starts */
  baseIndent: string
}

export function jsonPutSt(a: JsonPutArgs): SrcTerm {
  // Root-of-document case: the Document node itself is the alignment
  // position for whole-value edits; keep its boundary trivia.
  if (a.oldSource.data.kind === 'Document') {
    const kids = a.oldSource.children
    const valueIdx = kids.findIndex((c) => c.data.kind !== 'Trivia')
    const value = putNode(a.editedView, a.oldView, kids[valueIdx], a.baseIndent, a)
    if (value === kids[valueIdx]) return a.oldSource
    const children = kids.map((c, i) => (i === valueIdx ? value : c))
    return srcOps.make(a.oldSource.label, a.oldSource.data, children)
  }
  return putNode(a.editedView, a.oldView, a.oldSource, a.baseIndent, a)
}

const KIND_MATCH: Record<VKind, SKind> = {
  VObject: 'Object',
  VArray: 'Array',
  VMember: 'Member',
  VString: 'StringLit',
  VNumber: 'NumberLit',
  VBool: 'BoolLit',
  VNull: 'NullLit',
}

function putNode(
  v: ViewTerm,
  oldV: ViewTerm | null,
  oldS: SrcTerm | null,
  indent: string,
  a: JsonPutArgs,
): SrcTerm {
  // (1) untouched subtree: everything (formatting, lexemes, labels) preserved
  if (oldV !== null && v === oldV && oldS !== null) return oldS

  // (3) no old counterpart, or label/kind changed: fresh CST from the view
  if (
    oldS === null ||
    oldV === null ||
    v.label !== oldS.label ||
    KIND_MATCH[v.data.kind] !== oldS.data.kind
  ) {
    return fromViewFresh(v, indent, a)
  }

  // (2) same node: keep its tokens, recurse
  switch (v.data.kind) {
    case 'VString': {
      const d = oldS.data
      if (d.kind === 'StringLit' && d.value === v.data.value) return oldS
      return mkStringLit(oldS.label, encodeString(v.data.value), v.data.value)
    }
    case 'VNumber': {
      const d = oldS.data
      if (d.kind === 'NumberLit' && Object.is(d.value, v.data.value)) return oldS
      return mkNumberLit(oldS.label, renderNumber(v.data.value), v.data.value)
    }
    case 'VBool': {
      const d = oldS.data
      if (d.kind === 'BoolLit' && d.value === v.data.value) return oldS
      return mkBoolLit(oldS.label, v.data.value)
    }
    case 'VNull':
      return oldS
    case 'VMember': {
      if (v.children[0]?.data.kind !== 'VString') {
        throw new Error('putSt: member key must be a string')
      }
      const keyIdx = 0
      const valIdx = oldS.children.length - 1
      const key = putNode(v.children[0], oldV.children[0], oldS.children[keyIdx], indent, a)
      const val = putNode(v.children[1], oldV.children[1], oldS.children[valIdx], indent, a)
      if (key === oldS.children[keyIdx] && val === oldS.children[valIdx]) return oldS
      const children = oldS.children.map((c, i) => (i === keyIdx ? key : i === valIdx ? val : c))
      return srcOps.make(oldS.label, oldS.data, children)
    }
    case 'VObject':
    case 'VArray':
      return putContainer(v, oldV, oldS, indent, a)
  }
}

// ---- container reassembly -------------------------------------------------

interface OldItemMeta {
  node: SrcTerm
  /** trivia immediately before the item (after '{'/',' ) */
  pre: SrcTerm | null
  /** trivia between the previous item and the comma */
  commaLead: SrcTerm | null
  comma: SrcTerm | null
}

interface OldLayout {
  open: SrcTerm
  close: SrcTerm
  items: OldItemMeta[]
  endGap: SrcTerm | null
}

function parseLayout(oldS: SrcTerm): OldLayout {
  const kids = oldS.children
  const open = kids[0]
  const close = kids[kids.length - 1]
  const items: OldItemMeta[] = []
  let pendingTrivia: SrcTerm | null = null
  let pendingCommaLead: SrcTerm | null = null
  let pendingComma: SrcTerm | null = null
  for (let i = 1; i < kids.length - 1; i++) {
    const c = kids[i]
    if (c.data.kind === 'Trivia') {
      pendingTrivia = c
    } else if (c.data.kind === 'Punct' && c.data.ch === ',') {
      pendingCommaLead = pendingTrivia
      pendingComma = c
      pendingTrivia = null
    } else {
      items.push({ node: c, pre: pendingTrivia, commaLead: pendingCommaLead, comma: pendingComma })
      pendingTrivia = null
      pendingCommaLead = null
      pendingComma = null
    }
  }
  return { open, close, items, endGap: pendingTrivia }
}

function putContainer(
  v: ViewTerm,
  oldV: ViewTerm,
  oldS: SrcTerm,
  indent: string,
  a: JsonPutArgs,
): SrcTerm {
  const layout = parseLayout(oldS)

  // pair old view children with old source items by position (get preserves
  // item order), then index by label
  const oldByLabel = new Map<number, { viewChild: ViewTerm; meta: OldItemMeta }>()
  oldV.children.forEach((vc, i) => {
    const meta = layout.items[i]
    if (meta) oldByLabel.set(vc.label, { viewChild: vc, meta })
  })

  const multiline =
    layout.items.length > 0
      ? containerIsMultiline(layout)
      : v.children.length > 0 && wouldBeLong(v)
  const childIndent = indent + a.fmt.indentUnit

  interface NewItem {
    node: SrcTerm
    meta: OldItemMeta | null
  }
  const newItems: NewItem[] = v.children.map((vc) => {
    const old = oldByLabel.get(vc.label)
    if (old) {
      return { node: putNode(vc, old.viewChild, old.meta.node, childIndent, a), meta: old.meta }
    }
    return { node: fromViewFresh(vc, childIndent, a), meta: null }
  })

  // fast path: identical membership, order and content
  if (
    newItems.length === layout.items.length &&
    newItems.every((n, i) => n.meta === layout.items[i] && n.node === layout.items[i].node)
  ) {
    return oldS
  }

  const children: SrcTerm[] = [layout.open]
  const pushTrivia = (t: SrcTerm | null, synth: string) => {
    if (t) children.push(t)
    else if (synth.length > 0) children.push(mkTrivia(a.alloc.fresh(), synth))
  }

  newItems.forEach((it, k) => {
    if (k === 0) {
      // no comma before the first item
      const synth = multiline ? a.fmt.newline + childIndent : firstInlineGap(layout)
      pushTrivia(it.meta?.pre ?? null, synth)
    } else {
      const prev = newItems[k - 1]
      // trivia before the comma: only reproducible from this item's old meta
      if (it.meta?.commaLead && it.meta.comma) children.push(it.meta.commaLead)
      children.push(it.meta?.comma ?? mkPunct(a.alloc.fresh(), ','))
      const synth = multiline ? a.fmt.newline + childIndent : ' '
      // clone this item's old pre-trivia; else fall back to the previous
      // reused item's spacing style; else synthesize
      const pre = it.meta?.pre ?? (prev.meta?.pre && k > 0 ? null : null)
      pushTrivia(pre, synth)
    }
    children.push(it.node)
  })

  if (newItems.length > 0) {
    pushTrivia(layout.endGap, multiline ? a.fmt.newline + indent : firstInlineGap(layout))
  }
  children.push(layout.close)
  return srcOps.make(oldS.label, oldS.data, mergeAdjTrivia(children))
}

function containerIsMultiline(layout: OldLayout): boolean {
  const has = (t: SrcTerm | null) =>
    t !== null && t.data.kind === 'Trivia' && t.data.text.includes('\n')
  return layout.items.some((m) => has(m.pre) || has(m.commaLead)) || has(layout.endGap)
}

/** inline gap style right after the opening bracket ('' or ' ') */
function firstInlineGap(layout: OldLayout): string {
  const pre = layout.items[0]?.pre
  if (pre && pre.data.kind === 'Trivia' && !pre.data.text.includes('\n')) return pre.data.text
  return ''
}

function wouldBeLong(v: ViewTerm): boolean {
  let n = 0
  const count = (x: ViewTerm): void => {
    n += 8
    x.children.forEach(count)
  }
  count(v)
  return n > 40
}

function mergeAdjTrivia(children: SrcTerm[]): SrcTerm[] {
  const out: SrcTerm[] = []
  for (const c of children) {
    const prev = out[out.length - 1]
    if (prev && prev.data.kind === 'Trivia' && c.data.kind === 'Trivia') {
      out[out.length - 1] = mkTrivia(prev.label, prev.data.text + c.data.text)
    } else if (c.data.kind === 'Trivia' && c.data.text.length === 0) {
      // skip empty
    } else {
      out.push(c)
    }
  }
  return out
}

// ---- fresh generation -----------------------------------------------------

function renderNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error('putSt: non-finite number')
  return JSON.stringify(n)
}

/** Generate CST for a brand-new view subtree. Structural nodes CARRY THE
 * VIEW LABELS (so get ∘ put reproduces the edited view label-exactly);
 * token children get fresh labels. */
export function fromViewFresh(v: ViewTerm, indent: string, a: JsonPutArgs): SrcTerm {
  switch (v.data.kind) {
    case 'VString':
      return mkStringLit(v.label, encodeString(v.data.value), v.data.value)
    case 'VNumber':
      return mkNumberLit(v.label, renderNumber(v.data.value), v.data.value)
    case 'VBool':
      return mkBoolLit(v.label, v.data.value)
    case 'VNull':
      return mkNullLit(v.label)
    case 'VMember': {
      if (v.children[0]?.data.kind !== 'VString') {
        throw new Error('putSt: member key must be a string')
      }
      const key = fromViewFresh(v.children[0], indent, a)
      const value = fromViewFresh(v.children[1], indent, a)
      return srcOps.make(v.label, { kind: 'Member', len: 0 }, [
        key,
        mkPunct(a.alloc.fresh(), ':'),
        mkTrivia(a.alloc.fresh(), ' '),
        value,
      ])
    }
    case 'VObject':
    case 'VArray': {
      const [openCh, closeCh] = v.data.kind === 'VObject' ? (['{', '}'] as const) : (['[', ']'] as const)
      const childIndent = indent + a.fmt.indentUnit
      const items = v.children.map((c) => fromViewFresh(c, childIndent, a))
      const inlineLen = items.reduce((acc, t) => acc + t.data.len + 2, 2)
      const multiline = inlineLen > 40 || items.some((t) => render(t).includes('\n'))
      const children: SrcTerm[] = [mkPunct(a.alloc.fresh(), openCh)]
      items.forEach((it, k) => {
        if (k > 0) children.push(mkPunct(a.alloc.fresh(), ','))
        if (multiline) children.push(mkTrivia(a.alloc.fresh(), a.fmt.newline + childIndent))
        else if (k > 0) children.push(mkTrivia(a.alloc.fresh(), ' '))
        children.push(it)
      })
      if (items.length > 0 && multiline) {
        children.push(mkTrivia(a.alloc.fresh(), a.fmt.newline + indent))
      }
      children.push(mkPunct(a.alloc.fresh(), closeCh))
      return srcOps.make(v.label, { kind: v.data.kind === 'VObject' ? 'Object' : 'Array', len: 0 }, children)
    }
  }
}
