/**
 * The JSON view — the plain structured tree the right-hand editor shows.
 * `get` (json/get.ts) projects the CST onto this type, dropping formatting
 * but COPYING labels (get may drop labels, never invent them — Req. 18).
 *
 * Objects are ordered member lists, not maps: duplicate keys are
 * representable and preserved.
 */

import type { Term, TermOps } from '../core/term'
import type { LabelAllocator } from '../core/label'

export type VData =
  | { kind: 'VObject' } //  children: VMember*
  | { kind: 'VArray' } //   children: values
  | { kind: 'VMember' } //  children: [VString key, value]
  | { kind: 'VString'; value: string }
  | { kind: 'VNumber'; value: number }
  | { kind: 'VBool'; value: boolean }
  | { kind: 'VNull' }

export type VKind = VData['kind']
export type ViewTerm = Term<VData>

export const viewOps: TermOps<VData> = {
  make(label, data, children) {
    return { label, data, children }
  },
  equalData(a, b) {
    if (a.kind !== b.kind) return false
    switch (a.kind) {
      case 'VString':
        return a.value === (b as typeof a).value
      case 'VNumber':
        return Object.is(a.value, (b as typeof a).value)
      case 'VBool':
        return a.value === (b as typeof a).value
      default:
        return true
    }
  },
}

/** Semantic equality — label-blind (used by the Consistency law). */
export function viewEquals(a: ViewTerm, b: ViewTerm): boolean {
  if (!viewOps.equalData(a.data, b.data)) return false
  if (a.children.length !== b.children.length) return false
  for (let i = 0; i < a.children.length; i++) {
    if (!viewEquals(a.children[i], b.children[i])) return false
  }
  return true
}

/** Label-and-value equality (used to detect formatting-only text edits). */
export function viewIdentical(a: ViewTerm, b: ViewTerm): boolean {
  if (a === b) return true
  if (a.label !== b.label || !viewOps.equalData(a.data, b.data)) return false
  if (a.children.length !== b.children.length) return false
  for (let i = 0; i < a.children.length; i++) {
    if (!viewIdentical(a.children[i], b.children[i])) return false
  }
  return true
}

export function toPlainJson(v: ViewTerm): unknown {
  switch (v.data.kind) {
    case 'VObject': {
      const o: Record<string, unknown> = {}
      for (const m of v.children) {
        const key = m.children[0]
        if (key.data.kind !== 'VString') throw new Error('toPlainJson: malformed member')
        o[key.data.value] = toPlainJson(m.children[1])
      }
      return o
    }
    case 'VArray':
      return v.children.map(toPlainJson)
    case 'VMember':
      throw new Error('toPlainJson: bare member')
    case 'VString':
      return v.data.value
    case 'VNumber':
      return v.data.value
    case 'VBool':
      return v.data.value
    case 'VNull':
      return null
  }
}

export function fromPlainJson(x: unknown, alloc: LabelAllocator): ViewTerm {
  if (x === null) return { label: alloc.fresh(), data: { kind: 'VNull' }, children: [] }
  switch (typeof x) {
    case 'string':
      return { label: alloc.fresh(), data: { kind: 'VString', value: x }, children: [] }
    case 'number':
      if (!Number.isFinite(x)) throw new Error('fromPlainJson: non-finite number')
      return { label: alloc.fresh(), data: { kind: 'VNumber', value: x }, children: [] }
    case 'boolean':
      return { label: alloc.fresh(), data: { kind: 'VBool', value: x }, children: [] }
    case 'object': {
      if (Array.isArray(x)) {
        return {
          label: alloc.fresh(),
          data: { kind: 'VArray' },
          children: x.map((item) => fromPlainJson(item, alloc)),
        }
      }
      const entries = Object.entries(x as Record<string, unknown>)
      return {
        label: alloc.fresh(),
        data: { kind: 'VObject' },
        children: entries.map(([k, val]) => {
          const keyNode: ViewTerm = {
            label: alloc.fresh(),
            data: { kind: 'VString', value: k },
            children: [],
          }
          return {
            label: alloc.fresh(),
            data: { kind: 'VMember' },
            children: [keyNode, fromPlainJson(val, alloc)],
          } as ViewTerm
        }),
      }
    }
    default:
      throw new Error(`fromPlainJson: unsupported ${typeof x}`)
  }
}
