import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { redo, undo } from '@codemirror/commands'
import type { JsonKind, Label } from '../../engine'
import { defaultForType } from '../../engine'
import type { SyncController } from '../sync/SyncController'
import type { UiStore } from '../store/uiStore'
import { useUiStore } from '../store/uiStore'
import { flatten } from './flatten'
import type { RowHandlers } from './TreeRow'
import { TreeRow } from './TreeRow'

const ROW_H = 26
const OVERSCAN = 12

export function TreeView({ controller, store }: { controller: SyncController; store: UiStore }) {
  const view = useUiStore(store, (s) => s.view)
  const collapsed = useUiStore(store, (s) => s.collapsed)
  const stale = useUiStore(store, (s) => s.stale)
  const parseError = useUiStore(store, (s) => s.parseError)
  const caretPath = useUiStore(store, (s) => s.caretPath)
  const selectionPath = useUiStore(store, (s) => s.selectionPath)
  const structFocus = useUiStore(store, (s) => s.structFocus)
  const editing = useUiStore(store, (s) => s.editing)
  const dirtyAncestors = useUiStore(store, (s) => s.dirtyAncestors)

  const rows = useMemo(() => flatten(view, collapsed), [view, collapsed])
  const indexOfLabel = useMemo(() => {
    const m = new Map<Label, number>()
    rows.forEach((r, i) => m.set(r.label, i))
    return m
  }, [rows])

  // ---- stale scoping: which rows belong to the broken subtree ---------------
  // [start, end) row range that is stale; null = nothing, 'all' = whole tree
  const staleRange = useMemo((): { start: number; end: number } | 'all' | null => {
    if (!stale) return null
    // deepest ancestor of the broken region that is currently visible
    for (let k = dirtyAncestors.length - 1; k >= 0; k--) {
      const idx = indexOfLabel.get(dirtyAncestors[k])
      if (idx !== undefined) {
        const depth = rows[idx].depth
        let end = idx + 1
        while (end < rows.length && rows[end].depth > depth) end++
        return { start: idx, end }
      }
    }
    return 'all'
  }, [stale, dirtyAncestors, rows, indexOfLabel])
  const isRowStale = useCallback(
    (idx: number): boolean =>
      staleRange === 'all' || (staleRange !== null && idx >= staleRange.start && idx < staleRange.end),
    [staleRange],
  )

  // ---- windowing ------------------------------------------------------------
  const scroller = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState({ first: 0, count: 60 })
  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const first = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN)
    const count = Math.ceil(el.clientHeight / ROW_H) + OVERSCAN * 2
    setRange((r) => (r.first === first && r.count === count ? r : { first, count }))
  }, [])
  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  // scroll the mirrored selection into visibility
  const highlightTarget = selectionPath[selectionPath.length - 1] ?? caretPath[caretPath.length - 1]
  useEffect(() => {
    if (highlightTarget === undefined) return
    const idx = indexOfLabel.get(highlightTarget)
    const el = scroller.current
    if (idx === undefined || !el) return
    const top = idx * ROW_H
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 2) })
    }
  }, [highlightTarget, indexOfLabel])

  // ---- edit dispatch handlers -------------------------------------------------
  const handlers: RowHandlers = useMemo(
    () => ({
      onFocus(row) {
        controller.focusLabel(row.label, { scroll: true })
      },
      onToggle(row) {
        store.toggleCollapsed(row.label)
      },
      onBeginEdit(row, field) {
        const target = field === 'key' ? (row.keyLabel ?? row.label) : row.label
        controller.beginInlineEdit(target, field)
      },
      onCommitKey(row, key) {
        controller.endInlineEdit()
        if (row.keyLabel !== null && key !== row.key) {
          controller.dispatchViewEdit({ type: 'renameKey', keyLabel: row.keyLabel, newKey: key })
        }
      },
      onCommitValue(row, value) {
        controller.endInlineEdit()
        const cur = row.node
        const same =
          (cur.kind === 'string' && cur.value === value) ||
          (cur.kind === 'number' && cur.value === value) ||
          (cur.kind === 'boolean' && cur.value === value) ||
          (cur.kind === 'null' && value === null)
        if (!same) controller.dispatchViewEdit({ type: 'setScalar', label: row.label, value })
      },
      onCancelEdit() {
        controller.endInlineEdit()
      },
      onTabEdit(row, field, back) {
        // advance to the next/previous editable cell in flat-row order
        const idx = indexOfLabel.get(row.label)
        if (idx === undefined) return
        const cells: { label: Label; field: 'key' | 'value' }[] = []
        for (const r of rows) {
          if (r.key !== null) cells.push({ label: r.label, field: 'key' })
          if (r.kind !== 'object' && r.kind !== 'array') cells.push({ label: r.label, field: 'value' })
        }
        const at = cells.findIndex((c) => c.label === row.label && c.field === field)
        const next = cells[at + (back ? -1 : 1)]
        if (next) {
          const target = rows[indexOfLabel.get(next.label)!]
          controller.beginInlineEdit(
            next.field === 'key' ? (target.keyLabel ?? target.label) : target.label,
            next.field,
          )
        }
      },
      onChangeType(row, kind: JsonKind) {
        controller.dispatchViewEdit({ type: 'changeType', label: row.label, newType: kind })
        controller.focusLabel(row.label)
      },
      onAddChild(row) {
        addInto(controller, store, row.node.kind === 'object', row.label, 0)
      },
      onRemove(row) {
        controller.dispatchViewEdit({ type: 'remove', label: row.label })
        if (row.parent !== null) controller.focusLabel(row.parent)
      },
      siblingKeysOf(row) {
        if (row.parent === null) return []
        const parentRow = rows[indexOfLabel.get(row.parent) ?? -1]
        if (!parentRow || parentRow.node.kind !== 'object') return []
        return parentRow.node.entries.filter((e) => e.value.label !== row.label).map((e) => e.key)
      },
    }),
    [controller, store, rows, indexOfLabel],
  )

  // ---- keyboard navigation -----------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
    // route undo/redo to the text pane's single history
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      const cm = controller.editorView
      if (cm) {
        if (e.shiftKey) redo(cm)
        else undo(cm)
      }
      return
    }
    const cur = structFocus !== null ? indexOfLabel.get(structFocus) : undefined
    const move = (idx: number): void => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, idx))]
      if (row) controller.focusLabel(row.label, { scroll: true })
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(cur === undefined ? 0 : cur + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(cur === undefined ? 0 : cur - 1)
        break
      case 'ArrowRight': {
        if (cur === undefined) break
        e.preventDefault()
        const row = rows[cur]
        if (row.hasChildren && collapsed.has(row.label)) store.toggleCollapsed(row.label)
        else if (row.hasChildren) move(cur + 1)
        break
      }
      case 'ArrowLeft': {
        if (cur === undefined) break
        e.preventDefault()
        const row = rows[cur]
        if (row.hasChildren && !collapsed.has(row.label)) store.toggleCollapsed(row.label)
        else if (row.parent !== null) {
          const p = indexOfLabel.get(row.parent)
          if (p !== undefined) move(p)
        }
        break
      }
      case 'Enter':
      case 'F2': {
        if (cur === undefined || isRowStale(cur)) break
        e.preventDefault()
        const row = rows[cur]
        if (e.shiftKey && row.key !== null) handlers.onBeginEdit(row, 'key')
        else if (row.kind !== 'object' && row.kind !== 'array') handlers.onBeginEdit(row, 'value')
        break
      }
      case 'Backspace':
      case 'Delete': {
        if (cur === undefined || isRowStale(cur)) break
        e.preventDefault()
        const row = rows[cur]
        if (row.parent !== null) handlers.onRemove(row)
        break
      }
    }
  }

  // keep DOM focus on the focused row for keyboard nav
  useEffect(() => {
    if (structFocus === null || !scroller.current) return
    const el = scroller.current.querySelector<HTMLElement>(`[data-label="${structFocus}"]`)
    if (el && document.activeElement?.tagName !== 'INPUT') el.focus({ preventScroll: true })
  }, [structFocus, rows])

  if (!view) {
    return (
      <div className="tree tree--empty">
        <div className="tree-banner tree-banner--info">
          Empty document — type JSON on the left, or{' '}
          <button className="tree-link" onClick={() => controller.loadText('{\n  \n}')}>
            start an object
          </button>
        </div>
      </div>
    )
  }

  const caretSet = new Set(caretPath.slice(0, -1))
  const selAncestors = new Set(selectionPath.slice(0, -1))
  const caretLeaf = caretPath[caretPath.length - 1]
  const selLeaf = selectionPath[selectionPath.length - 1]

  const total = rows.length
  let first = range.first
  let last = Math.min(total, first + range.count)
  // pin the row being edited into the render set so focus is not lost
  if (editing) {
    const i = indexOfLabel.get(editing.label)
    if (i !== undefined && (i < first || i >= last)) {
      first = Math.min(first, i)
      last = Math.max(last, i + 1)
    }
  }
  const slice = rows.slice(first, last)

  const wholeTreeStale = staleRange === 'all'
  return (
    <div className={`tree ${wholeTreeStale ? 'tree--stale' : ''}`} aria-disabled={wholeTreeStale}>
      {stale && (
        <div className="tree-banner tree-banner--error" role="status">
          {wholeTreeStale
            ? 'Invalid JSON — showing last valid state'
            : 'Invalid JSON — the grayed part shows its last valid state; the rest stays editable'}
          {parseError ? ` (${parseError.message})` : ''}
        </div>
      )}
      <div className="tree-scroll" ref={scroller} onScroll={measure} role="tree" onKeyDown={onKeyDown}>
        <div className="tree-spacer" style={{ height: total * ROW_H }}>
          {slice.map((row, k) => (
            <TreeRow
              key={row.label}
              row={row}
              rowStale={isRowStale(first + k)}
              top={(first + k) * ROW_H}
              isCaret={row.label === caretLeaf && row.label !== selLeaf}
              isSelected={row.label === selLeaf || row.label === structFocus}
              isAncestor={selAncestors.has(row.label) || caretSet.has(row.label)}
              isFocus={row.label === structFocus}
              isCollapsed={collapsed.has(row.label)}
              editingField={
                editing &&
                ((editing.field === 'key' && editing.label === (row.keyLabel ?? row.label)) ||
                  (editing.field === 'value' && editing.label === row.label))
                  ? editing.field
                  : null
              }
              disabled={isRowStale(first + k)}
              h={handlers}
            />
          ))}
        </div>
      </div>
    </div>
  )
}


export function addInto(
  controller: SyncController,
  store: UiStore,
  isObject: boolean,
  parentLabel: Label,
  index: number,
): void {
  const edit = isObject
    ? ({ type: 'insertMember', parentLabel, index, key: '', value: null } as const)
    : ({ type: 'insertItem', parentLabel, index, value: defaultForType('null') } as const)
  const newLabel = controller.dispatchViewEdit(edit)
  store.revealPath([parentLabel])
  if (newLabel !== null) {
    controller.focusLabel(newLabel, { scroll: true })
    if (isObject) {
      // open the key editor on the new row (editing state is keyed by the
      // key label for key edits)
      const view = controller.engine.getView()
      const keyLabel = view ? findKeyLabel(view, newLabel) : null
      if (keyLabel !== null) controller.beginInlineEdit(keyLabel, 'key')
    }
  }
}

function findKeyLabel(view: import('../../engine').JsonView, valueLabel: Label): Label | null {
  if (view.kind === 'object') {
    for (const e of view.entries) {
      if (e.value.label === valueLabel) return e.keyLabel
      const hit = findKeyLabel(e.value, valueLabel)
      if (hit !== null) return hit
    }
  } else if (view.kind === 'array') {
    for (const item of view.items) {
      const hit = findKeyLabel(item, valueLabel)
      if (hit !== null) return hit
    }
  }
  return null
}
