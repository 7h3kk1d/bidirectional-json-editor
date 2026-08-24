/**
 * Concrete path-addressed view edits (paper Section 6.1).
 *
 * `affect` returns the PARENT path for insert/delete/move — the sibling list
 * is what changed, which makes `mcp` land on the container so commas and
 * separators are rewritable — and the node's own path for in-place edits.
 * All are evaluated against the original view (see core/edit.ts).
 */

import type { LabelAllocator, Path } from '../core/label'
import type { Term } from '../core/term'
import { zoom } from '../core/term'
import { replaceAt } from '../core/context'
import type { EditP } from '../core/edit'
import type { VData, ViewTerm } from './view'
import { fromPlainJson, viewOps } from './view'

export type Scalar = string | number | boolean | null

function scalarData(value: Scalar): VData {
  if (value === null) return { kind: 'VNull' }
  switch (typeof value) {
    case 'string':
      return { kind: 'VString', value }
    case 'number':
      if (!Number.isFinite(value)) throw new Error('setScalar: non-finite number')
      return { kind: 'VNumber', value }
    case 'boolean':
      return { kind: 'VBool', value }
  }
}

function editAt(
  path: Path,
  f: (node: ViewTerm) => ViewTerm,
): (rel: Path, t: Term<VData>) => Term<VData> {
  void path
  return (rel, t) => replaceAt(viewOps, t, rel, f(zoom(t, rel)))
}

/** Replace a scalar's value in place — the node keeps its label (and hence
 * its text identity while retyping). Also used for key renames: the key slot
 * of a member is just a VString at child 0. */
export function setScalar(path: Path, value: Scalar): EditP<VData> {
  return {
    path,
    edit: editAt(path, (node) => ({ label: node.label, data: scalarData(value), children: [] })),
    affect: (rel) => rel,
  }
}

/** Rename a member's key: setScalar into the key slot. */
export function renameKey(memberPath: Path, newKey: string): EditP<VData> {
  return setScalar([...memberPath, 0], newKey)
}

/** Replace the value at `path` with a fresh subtree built from plain JSON.
 * The new root keeps the old node's label so UI selection survives. */
export function replaceValue(path: Path, spec: unknown, alloc: LabelAllocator): EditP<VData> {
  return {
    path,
    edit: editAt(path, (node) => {
      const fresh = fromPlainJson(spec, alloc)
      return { label: node.label, data: fresh.data, children: fresh.children }
    }),
    affect: (rel) => rel,
  }
}

export interface MemberSpec {
  key: string
  value: unknown
}

/** Insert a child into a container. For objects pass a MemberSpec; for
 * arrays pass the plain JSON value. */
export function insertChild(
  parentPath: Path,
  index: number,
  spec: MemberSpec | { item: unknown },
  alloc: LabelAllocator,
): EditP<VData> {
  return {
    path: parentPath,
    edit: editAt(parentPath, (parent) => {
      let node: ViewTerm
      if ('key' in spec) {
        const keyNode: ViewTerm = {
          label: alloc.fresh(),
          data: { kind: 'VString', value: spec.key },
          children: [],
        }
        node = {
          label: alloc.fresh(),
          data: { kind: 'VMember' },
          children: [keyNode, fromPlainJson(spec.value, alloc)],
        }
      } else {
        node = fromPlainJson(spec.item, alloc)
      }
      const children = [...parent.children]
      children.splice(Math.max(0, Math.min(index, children.length)), 0, node)
      return viewOps.make(parent.label, parent.data, children)
    }),
    affect: (rel) => rel,
  }
}

export function deleteChild(parentPath: Path, index: number): EditP<VData> {
  return {
    path: parentPath,
    edit: editAt(parentPath, (parent) => {
      const children = parent.children.filter((_, i) => i !== index)
      return viewOps.make(parent.label, parent.data, children)
    }),
    affect: (rel) => rel,
  }
}

export function moveChild(parentPath: Path, from: number, to: number): EditP<VData> {
  return {
    path: parentPath,
    edit: editAt(parentPath, (parent) => {
      const children = [...parent.children]
      const [m] = children.splice(from, 1)
      children.splice(to, 0, m)
      return viewOps.make(parent.label, parent.data, children)
    }),
    affect: (rel) => rel,
  }
}
