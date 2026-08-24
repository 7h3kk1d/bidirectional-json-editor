/** JSONPath rendering for the breadcrumb / status bar. */

import type { JsonView, Label } from '../../engine'

export interface PathSeg {
  label: Label
  text: string
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Follow a root..deepest label path through the view, rendering segments. */
export function pathSegments(view: JsonView | null, labels: readonly Label[]): PathSeg[] {
  if (!view || labels.length === 0) return []
  const segs: PathSeg[] = [{ label: view.label, text: '$' }]
  let cur: JsonView = view
  for (let i = 1; i < labels.length; i++) {
    const target = labels[i]
    let next: JsonView | null = null
    let text = ''
    if (cur.kind === 'object') {
      for (const e of cur.entries) {
        if (e.value.label === target || e.keyLabel === target) {
          next = e.value
          text = IDENT.test(e.key) ? `.${e.key}` : `[${JSON.stringify(e.key)}]`
          break
        }
      }
    } else if (cur.kind === 'array') {
      for (let k = 0; k < cur.items.length; k++) {
        if (cur.items[k].label === target) {
          next = cur.items[k]
          text = `[${k}]`
          break
        }
      }
    }
    if (!next) break
    segs.push({ label: next.label, text })
    cur = next
  }
  return segs
}

export function jsonPathOf(view: JsonView | null, labels: readonly Label[]): string {
  return pathSegments(view, labels)
    .map((s) => s.text)
    .join('')
}
