/**
 * Labels — the paper's unique node identifiers (Section 2.3).
 *
 * Labels are opaque, monotonically allocated numbers with document lifetime.
 * They are never paths: paths are derived on demand via the LabelRegistry,
 * which is the paper's `locate` (Corollary 3) materialized as an index.
 */

export type Label = number

export type LabelSet = ReadonlySet<Label>

export type Path = readonly number[]

export class LabelAllocator {
  private n = 1
  fresh(): Label {
    return this.n++
  }
}

interface Entry {
  parent: Label | null
  childIndex: number
}

/** Minimal structural view of a term, so the registry stays instance-agnostic. */
export interface TermLite {
  readonly label: Label
  readonly children: readonly TermLite[]
}

/**
 * label -> (parent, childIndex) index over one tree (source or view).
 * `locate` climbs parent links: O(depth). Splices touch only the subtree
 * being swapped plus the sibling level of the splice.
 */
export class LabelRegistry {
  private entries = new Map<Label, Entry>()

  has(l: Label): boolean {
    return this.entries.has(l)
  }

  parentOf(l: Label): Label | null {
    const e = this.entries.get(l)
    return e ? e.parent : null
  }

  /** Root-relative path of the node labelled `l`, or null if unknown. */
  locate(l: Label): Path | null {
    if (!this.entries.has(l)) return null
    const rev: number[] = []
    let cur: Label | null = l
    while (cur !== null) {
      const e: Entry | undefined = this.entries.get(cur)
      if (!e) return null
      if (e.parent === null) break
      rev.push(e.childIndex)
      cur = e.parent
    }
    return rev.reverse()
  }

  /** Register a whole subtree, rooted below `parent` at `childIndex`. */
  mount(root: TermLite, parent: Label | null, childIndex: number): void {
    this.entries.set(root.label, { parent, childIndex })
    for (let i = 0; i < root.children.length; i++) {
      this.mount(root.children[i], root.label, i)
    }
  }

  /** Remove a subtree's labels, except those in `keep` (they were reused and
   * will be re-registered by a subsequent mount). */
  unmount(root: TermLite, keep?: LabelSet): void {
    if (!keep || !keep.has(root.label)) this.entries.delete(root.label)
    for (const c of root.children) this.unmount(c, keep)
  }

  /** After a splice changed a node's child list, refresh the childIndex of
   * every direct child (subtree entries below them stay valid). */
  reindexChildren(parent: TermLite): void {
    for (let i = 0; i < parent.children.length; i++) {
      this.entries.set(parent.children[i].label, { parent: parent.label, childIndex: i })
    }
  }

  size(): number {
    return this.entries.size
  }
}
