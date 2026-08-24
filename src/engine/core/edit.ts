/**
 * Path-addressed edits — the paper's context-sensitive EditP (Section 6.1):
 *   EditP t = { edit :: Path -> t -> t, affect :: Path -> t -> Path }
 *
 * `path` is the root-relative address the edit targets. `edit(rel, t)`
 * applies the edit at `rel` inside `t` (rel = path re-rooted at t);
 * `affect(rel, t)` returns the path (within t) of the affected subterm of
 * the ORIGINAL t — crucially evaluated against the un-edited view, so every
 * label it exposes exists in the source registry (paper Section 4.2).
 */

import type { Path } from './label'
import type { Term } from './term'

export interface EditP<D> {
  readonly path: Path
  edit(rel: Path, t: Term<D>): Term<D>
  affect(rel: Path, t: Term<D>): Path
}

/** The identity edit (for the Acceptability law, Theorem 25). */
export function identityEdit<D>(): EditP<D> {
  return {
    path: [],
    edit: (_rel, t) => t,
    affect: (_rel, _t) => [],
  }
}

/** Re-root `path` below `ancestor`; throws if `ancestor` is not a prefix. */
export function relativize(path: Path, ancestor: Path): Path {
  if (ancestor.length > path.length) {
    throw new Error(`relativize: ancestor longer than path`)
  }
  for (let i = 0; i < ancestor.length; i++) {
    if (path[i] !== ancestor[i]) {
      throw new Error(`relativize: [${ancestor}] is not a prefix of [${path}]`)
    }
  }
  return path.slice(ancestor.length)
}

/** Is `a` a (non-strict) prefix of `b`? */
export function isPrefix(a: Path, b: Path): boolean {
  if (a.length > b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
