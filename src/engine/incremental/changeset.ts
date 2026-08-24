/**
 * Text edits and position mapping. A pending list holds edits sequentially,
 * each in the coordinates of the text AFTER the previous ones (the order
 * they arrive from the editor).
 */

export interface TextEdit {
  from: number
  to: number
  insert: string
}

export function applyEdit(text: string, e: TextEdit): string {
  return text.slice(0, e.from) + e.insert + text.slice(e.to)
}

export function deltaOf(e: TextEdit): number {
  return e.insert.length - (e.to - e.from)
}

/** Map a position forward through one edit. */
export function mapPosThrough(e: TextEdit, pos: number, assoc: -1 | 1 = -1): number {
  if (pos < e.from || (pos === e.from && assoc === -1)) return pos
  if (pos > e.to || (pos === e.to && assoc === 1 && e.to > e.from)) return pos + deltaOf(e)
  // inside the replaced range
  return assoc === -1 ? e.from : e.from + e.insert.length
}

/** Map a position forward through a pending list (old -> current). */
export function mapPos(pending: readonly TextEdit[], pos: number, assoc: -1 | 1 = -1): number {
  let p = pos
  for (const e of pending) p = mapPosThrough(e, p, assoc)
  return p
}

/** Map a position backward through a pending list (current -> old). */
export function mapPosBack(pending: readonly TextEdit[], pos: number, assoc: -1 | 1 = -1): number {
  let p = pos
  for (let i = pending.length - 1; i >= 0; i--) {
    const e = pending[i]
    const inserted = e.insert.length
    if (p < e.from || (p === e.from && assoc === -1)) continue
    if (p > e.from + inserted || (p === e.from + inserted && assoc === 1 && inserted > 0)) {
      p -= deltaOf(e)
      continue
    }
    p = assoc === -1 ? e.from : e.to
  }
  return p
}
