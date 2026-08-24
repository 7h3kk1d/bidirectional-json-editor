/**
 * The UI's external store: presentation state only (the Engine owns the
 * document). Hand-rolled subscribe/getSnapshot pair consumed through
 * useSyncExternalStore.
 */

import { useSyncExternalStore } from 'react'
import type { JsonView, Label, ParseErrorView } from '../../engine'

export interface UiState {
  view: JsonView | null
  viewVersion: number
  changedLabel: Label | null
  stale: boolean
  parseError: ParseErrorView | null
  /** root..dirty ancestor labels of the broken subtree (empty = whole doc) */
  dirtyAncestors: readonly Label[]
  /** text caret: root..deepest view labels under the caret */
  caretPath: readonly Label[]
  /** text selection: root..deepest view node covering the selection */
  selectionPath: readonly Label[]
  /** struct pane roving focus */
  structFocus: Label | null
  editing: { label: Label; field: 'key' | 'value' } | null
  collapsed: ReadonlySet<Label>
  caretPos: { line: number; col: number }
  nodeCount: number
}

type Listener = () => void

export class UiStore {
  private state: UiState = {
    view: null,
    viewVersion: 0,
    changedLabel: null,
    stale: false,
    parseError: null,
    dirtyAncestors: [],
    caretPath: [],
    selectionPath: [],
    structFocus: null,
    editing: null,
    collapsed: new Set(),
    caretPos: { line: 1, col: 1 },
    nodeCount: 0,
  }
  private listeners = new Set<Listener>()

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): UiState => this.state

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  setDocument(view: JsonView | null, changedLabel: Label | null, nodeCount: number): void {
    this.set({
      view,
      changedLabel,
      viewVersion: this.state.viewVersion + 1,
      stale: false,
      parseError: null,
      dirtyAncestors: [],
      nodeCount,
    })
  }

  /** Update the view without touching the stale/dirty flags (structured
   * edits applied while the text is broken elsewhere). */
  updateView(view: JsonView | null, nodeCount: number): void {
    this.set({ view, viewVersion: this.state.viewVersion + 1, nodeCount })
  }

  setStale(parseError: ParseErrorView | null, dirtyAncestors: readonly Label[]): void {
    this.set({ stale: true, parseError, dirtyAncestors })
  }

  setEmpty(): void {
    this.set({ view: null, viewVersion: this.state.viewVersion + 1, stale: false, parseError: null, nodeCount: 0 })
  }

  setCaret(path: readonly Label[], pos: { line: number; col: number }): void {
    this.set({ caretPath: path, caretPos: pos, selectionPath: [] })
  }

  setSelection(path: readonly Label[], caretPath: readonly Label[], pos: { line: number; col: number }): void {
    // auto-expand collapsed ancestors so the highlighted row is visible
    const target = path[path.length - 1]
    let collapsed = this.state.collapsed
    if (target !== undefined) {
      const toExpand = path.slice(0, -1).filter((l) => collapsed.has(l))
      if (toExpand.length > 0) {
        const next = new Set(collapsed)
        for (const l of toExpand) next.delete(l)
        collapsed = next
      }
    }
    this.set({ selectionPath: path, caretPath, caretPos: pos, collapsed })
  }

  revealPath(path: readonly Label[]): void {
    const toExpand = path.slice(0, -1).filter((l) => this.state.collapsed.has(l))
    if (toExpand.length === 0) return
    const next = new Set(this.state.collapsed)
    for (const l of toExpand) next.delete(l)
    this.set({ collapsed: next })
  }

  setStructFocus(l: Label | null): void {
    this.set({ structFocus: l })
  }

  setEditing(e: UiState['editing']): void {
    this.set({ editing: e })
  }

  toggleCollapsed(l: Label): void {
    const next = new Set(this.state.collapsed)
    if (next.has(l)) next.delete(l)
    else next.add(l)
    this.set({ collapsed: next })
  }

  setCollapsedAll(labels: Iterable<Label>): void {
    this.set({ collapsed: new Set(labels) })
  }
}

export function useUiStore<T>(store: UiStore, selector: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}
