/**
 * Label transfer after a local reparse (Direction 2).
 *
 * A reparsed region comes back with fresh labels; to keep labels STABLE —
 * so UI selections and decorations survive unrelated edits — we pair the
 * old subtree with the new one and transfer old labels onto matching new
 * nodes. Matching is by construction kind:
 *   - same-kind roots transfer and recurse;
 *   - object members match by key (duplicates by occurrence order);
 *   - array items match by a greedy two-pointer over kinds;
 *   - leaves of the same kind transfer even when the lexeme changed, so
 *     retyping a number/string keeps its identity.
 * Runs only over the reparsed region: O(region).
 */

import type { SrcTerm } from './cst'
import { srcOps } from './cst'

/** If the transferred node is byte- and label-identical to the old one,
 * return the OLD node so untouched subtrees keep object identity (this also
 * preserves span caches and lets the memoized `get` reuse view nodes). */
function shared(oldT: SrcTerm, label: number, data: SrcTerm['data'], children: readonly SrcTerm[]): SrcTerm {
  if (
    label === oldT.label &&
    srcOps.equalData(oldT.data, data) &&
    children.length === oldT.children.length &&
    children.every((c, i) => c === oldT.children[i])
  ) {
    return oldT
  }
  return srcOps.make(label, data, children)
}


function tokenKey(t: SrcTerm): string | null {
  if (t.data.kind === 'Punct') return 'p' + t.data.ch
  if (t.data.kind === 'Trivia') return 't' + t.data.text
  return null
}

/** Per-content queues of old tokens; content-equal tokens are interchangeable
 * (their labels never reach the view), so matching by content restores object
 * identity for token runs around unchanged items. */
function tokenQueues(children: readonly SrcTerm[]): Map<string, SrcTerm[]> {
  const m = new Map<string, SrcTerm[]>()
  for (const c of children) {
    const k = tokenKey(c)
    if (k === null) continue
    const q = m.get(k)
    if (q) q.push(c)
    else m.set(k, [c])
  }
  return m
}

function takeToken(queues: Map<string, SrcTerm[]>, c: SrcTerm): SrcTerm {
  const k = tokenKey(c)
  if (k === null) return c
  const old = queues.get(k)?.shift()
  return old ?? c
}

export function transferLabels(oldT: SrcTerm, newT: SrcTerm): SrcTerm {
  if (oldT.data.kind !== newT.data.kind) return newT
  switch (newT.data.kind) {
    case 'StringLit':
    case 'NumberLit':
    case 'BoolLit':
    case 'NullLit':
    case 'Punct':
    case 'Trivia':
      return srcOps.equalData(oldT.data, newT.data)
        ? oldT
        : { label: oldT.label, data: newT.data, children: [] }
    case 'Member': {
      // children: StringLit Trivia? ':' Trivia? Value — match key & value, and
      // tokens positionally by kind.
      const children = matchSequence(oldT.children, newT.children)
      return shared(oldT, oldT.label, newT.data, children)
    }
    case 'Document': {
      const children = matchSequence(oldT.children, newT.children)
      return shared(oldT, oldT.label, newT.data, children)
    }
    case 'Object': {
      // Match members by key, in occurrence order for duplicates.
      const oldQueues = new Map<string, SrcTerm[]>()
      for (const c of oldT.children) {
        if (c.data.kind === 'Member') {
          const key = memberKey(c)
          const q = oldQueues.get(key)
          if (q) q.push(c)
          else oldQueues.set(key, [c])
        }
      }
      const toks = tokenQueues(oldT.children)
      const children = newT.children.map((c) => {
        if (c.data.kind !== 'Member') return takeToken(toks, c)
        const q = oldQueues.get(memberKey(c))
        const old = q?.shift()
        return old ? transferLabels(old, c) : c
      })
      return shared(oldT, oldT.label, newT.data, children)
    }
    case 'Array': {
      const oldItems = oldT.children.filter(isItem)
      const newItems = newT.children.filter(isItem)
      const pair = new Map<SrcTerm, SrcTerm>() // new -> old
      let i = 0
      let j = 0
      while (i < oldItems.length && j < newItems.length) {
        if (oldItems[i].data.kind === newItems[j].data.kind) {
          pair.set(newItems[j], oldItems[i])
          i++
          j++
        } else if (oldItems.length - i > newItems.length - j) {
          i++ // deletion
        } else if (oldItems.length - i < newItems.length - j) {
          j++ // insertion
        } else {
          i++ // replacement with a different kind: no transfer
          j++
        }
      }
      const toks = tokenQueues(oldT.children)
      const children = newT.children.map((c) => {
        if (tokenKey(c) !== null) return takeToken(toks, c)
        const old = pair.get(c)
        return old ? transferLabels(old, c) : c
      })
      return shared(oldT, oldT.label, newT.data, children)
    }
  }
}

function isItem(t: SrcTerm): boolean {
  return t.data.kind !== 'Punct' && t.data.kind !== 'Trivia'
}

function memberKey(m: SrcTerm): string {
  const k = m.children[0]
  return k.data.kind === 'StringLit' ? k.data.value : ''
}

/** Positional token-label transfer for a same-kind child sequence
 * (Member/Document children, where the shape is essentially fixed). */
function matchSequence(oldCs: readonly SrcTerm[], newCs: readonly SrcTerm[]): SrcTerm[] {
  const out: SrcTerm[] = []
  let i = 0
  for (const c of newCs) {
    // advance to the next old child of the same kind
    let k = i
    while (k < oldCs.length && oldCs[k].data.kind !== c.data.kind) k++
    if (k < oldCs.length) {
      out.push(transferLabels(oldCs[k], c))
      i = k + 1
    } else {
      out.push(c)
    }
  }
  return out
}
