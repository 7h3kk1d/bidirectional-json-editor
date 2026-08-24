/**
 * mcp — maximum common prefix of a set of paths (paper Section 4.1/4.2).
 * The mcp of the source paths of all labels in the affected view subterm is
 * the path to the smallest alignment position covering the edit (Theorem 23).
 */

import type { Path } from './label'

export function mcp(paths: readonly Path[]): Path {
  if (paths.length === 0) throw new Error('mcp: needs at least one path')
  let prefix = paths[0]
  let len = prefix.length
  for (let k = 1; k < paths.length && len > 0; k++) {
    const p = paths[k]
    const max = Math.min(len, p.length)
    let i = 0
    while (i < max && prefix[i] === p[i]) i++
    len = i
  }
  return prefix.slice(0, len)
}
