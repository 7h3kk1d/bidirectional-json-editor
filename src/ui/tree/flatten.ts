/**
 * Flatten the JsonView into the visible rows, DFS order. The flat-row model
 * makes windowing a pure slice, keyboard navigation an index ±1, and
 * memoization an object-identity check.
 */

import type { JsonKind, JsonView, Label } from '../../engine'

export interface FlatRow {
  label: Label
  keyLabel: Label | null
  key: string | null
  index: number | null
  depth: number
  parent: Label | null
  kind: JsonKind
  node: JsonView
  hasChildren: boolean
  childCount: number
}

export function flatten(view: JsonView | null, collapsed: ReadonlySet<Label>): FlatRow[] {
  const out: FlatRow[] = []
  if (!view) return out
  const walk = (
    node: JsonView,
    depth: number,
    parent: Label | null,
    key: string | null,
    keyLabel: Label | null,
    index: number | null,
  ): void => {
    const childCount =
      node.kind === 'object' ? node.entries.length : node.kind === 'array' ? node.items.length : 0
    out.push({
      label: node.label,
      keyLabel,
      key,
      index,
      depth,
      parent,
      kind: node.kind,
      node,
      hasChildren: childCount > 0,
      childCount,
    })
    if (collapsed.has(node.label)) return
    if (node.kind === 'object') {
      node.entries.forEach((e, i) => walk(e.value, depth + 1, node.label, e.key, e.keyLabel, i))
    } else if (node.kind === 'array') {
      node.items.forEach((item, i) => walk(item, depth + 1, node.label, null, null, i))
    }
  }
  walk(view, 0, null, null, null, null)
  return out
}

/** Default collapse policy for large documents: containers below depth 2
 * start collapsed when the fully-expanded row count would exceed the cap. */
export function defaultCollapsed(view: JsonView | null, cap = 5000): Set<Label> {
  const collapsed = new Set<Label>()
  if (!view) return collapsed
  let total = 0
  const count = (n: JsonView): void => {
    total++
    if (n.kind === 'object') n.entries.forEach((e) => count(e.value))
    else if (n.kind === 'array') n.items.forEach(count)
  }
  count(view)
  if (total <= cap) return collapsed
  const walk = (n: JsonView, depth: number): void => {
    const isContainer = n.kind === 'object' || n.kind === 'array'
    if (!isContainer) return
    if (depth >= 2) collapsed.add(n.label)
    if (n.kind === 'object') n.entries.forEach((e) => walk(e.value, depth + 1))
    else if (n.kind === 'array') n.items.forEach((i) => walk(i, depth + 1))
  }
  walk(view, 0)
  return collapsed
}
