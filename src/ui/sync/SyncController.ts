/**
 * SyncController — the ONE component allowed to talk to both the Engine and
 * the CodeMirror EditorView. React components dispatch through it and read
 * from the UiStore; this single funnel is what makes loop prevention
 * tractable (see syncAnnotations.ts for the loop breakers).
 */

import type { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorView as EV } from '@codemirror/view'
import { ViewEditBlockedError } from '../../engine'
import type { Engine, Label, Span, TextChange, ViewEdit } from '../../engine'
import type { UiStore } from '../store/uiStore'
import { syncOrigin } from '../codemirror/syncAnnotations'
import { setGhostCaret, setNodeHighlight } from '../codemirror/mirrorHighlight'
import { pushDiagnostics } from '../codemirror/diagnostics'

export class SyncController {
  private cm: EditorView | null = null
  private reentrant = false

  constructor(
    readonly engine: Engine,
    readonly store: UiStore,
  ) {}

  attachEditor(view: EditorView): void {
    this.cm = view
    this.refreshDocumentState(null)
  }

  detachEditor(): void {
    this.cm = null
  }

  // ---- path A: text-pane updates ------------------------------------------

  onCmUpdate(u: ViewUpdate): void {
    const origins = u.transactions.map((tr) => tr.annotation(syncOrigin))
    const fromEngine = origins.includes('engine')
    const fromMirror = origins.includes('mirror')

    if (u.docChanged && !fromEngine) {
      const changes: TextChange[] = []
      u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() })
      })
      this.guarded(() => {
        const res = this.engine.applyTextEdit(changes)
        if (res.parseError) {
          this.store.setStale(res.parseError, this.dirtyAncestors())
        } else if (res.view === null) {
          this.store.setEmpty()
        } else {
          this.store.setDocument(res.view, res.changedLabel, this.engine.nodeCount())
        }
        if (this.cm) pushDiagnostics(this.cm, res.parseError)
      })
    }

    if ((u.selectionSet || u.docChanged) && !fromMirror) {
      this.mapTextSelectionToStore(u)
    }
  }

  private mapTextSelectionToStore(u: ViewUpdate): void {
    const range = u.state.selection.main
    const line = u.state.doc.lineAt(range.head)
    const pos = { line: line.number, col: range.head - line.from + 1 }
    if (range.empty) {
      this.store.setCaret(this.engine.labelPathAtOffset(range.head), pos)
      return
    }
    const a = this.engine.labelPathAtOffset(range.from)
    const b = this.engine.labelPathAtOffset(Math.max(range.from, range.to - 1))
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    this.store.setSelection(a.slice(0, i), this.engine.labelPathAtOffset(range.head), pos)
  }

  // ---- path B: struct-pane edits ------------------------------------------

  dispatchViewEdit(edit: ViewEdit): Label | null {
    let resultLabel: Label | null = null
    this.guarded(() => {
      let res
      try {
        res = this.engine.applyViewEdit(edit)
      } catch (err) {
        if (err instanceof ViewEditBlockedError) return // overlaps the broken region: no-op
        throw err
      }
      if (res.textChanges.length > 0 && this.cm) {
        this.cm.dispatch({
          changes: res.textChanges,
          annotations: [syncOrigin.of('engine')],
          userEvent: 'input.structure',
        })
      }
      if (this.engine.isDirty()) this.store.updateView(res.view, this.engine.nodeCount())
      else this.store.setDocument(res.view, null, this.engine.nodeCount())
      resultLabel = this.newLabelFor(edit)
    })
    return resultLabel
  }

  private dirtyAncestors(): Label[] {
    const dl = this.engine.dirtyLabel()
    return dl === null ? [] : this.engine.ancestorsOf(dl)
  }

  /** After an insert, find the label of the created row so the UI can focus
   * or start editing it. */
  private newLabelFor(edit: ViewEdit): Label | null {
    const view = this.engine.getView()
    if (!view) return null
    if (edit.type === 'insertMember' || edit.type === 'insertItem') {
      const parentSpan = this.engine.spanOfLabel(edit.parentLabel)
      if (!parentSpan) return null
      const parent = findByLabel(view, edit.parentLabel)
      if (!parent) return null
      if (parent.kind === 'object' && edit.type === 'insertMember') {
        return parent.entries[edit.index]?.value.label ?? null
      }
      if (parent.kind === 'array' && edit.type === 'insertItem') {
        return parent.items[edit.index]?.label ?? null
      }
    }
    if (edit.type === 'setScalar' || edit.type === 'changeType') return edit.label
    return null
  }

  // ---- path D: struct-pane focus -> text highlight -------------------------

  focusLabel(label: Label, opts: { scroll?: boolean; reveal?: boolean } = {}): void {
    this.store.setStructFocus(label)
    if (!this.cm) return
    const span = this.engine.spanOfLabel(label)
    if (!span) return
    const ancestors: Span[] = []
    for (const l of this.engine.ancestorsOf(label)) {
      if (l === label) continue
      const s = this.engine.spanOfLabel(l)
      if (s) ancestors.push(s)
    }
    const effects = [setNodeHighlight.of({ span, ancestors })]
    this.cm.dispatch({
      effects: opts.scroll
        ? [...effects, EV.scrollIntoView(span.from, { y: 'nearest' })]
        : effects,
      annotations: [syncOrigin.of('mirror')],
      ...(opts.reveal ? { selection: { anchor: span.from, head: span.to } } : {}),
    })
  }

  clearStructFocus(): void {
    this.store.setStructFocus(null)
    if (this.cm) {
      this.cm.dispatch({
        effects: [setNodeHighlight.of(null)],
        annotations: [syncOrigin.of('mirror')],
      })
    }
  }

  // ---- ghost caret while inline-editing ------------------------------------

  beginInlineEdit(label: Label, field: 'key' | 'value'): void {
    this.store.setEditing({ label, field })
    if (!this.cm) return
    const span = this.engine.spanOfLabel(label)
    if (!span) return
    this.cm.dispatch({
      effects: [setGhostCaret.of(span.from)],
      annotations: [syncOrigin.of('mirror')],
    })
  }

  endInlineEdit(): void {
    this.store.setEditing(null)
    if (!this.cm) return
    this.cm.dispatch({
      effects: [setGhostCaret.of(null)],
      annotations: [syncOrigin.of('mirror')],
    })
  }

  // ---- document loading -----------------------------------------------------

  loadText(text: string): void {
    if (!this.cm) return
    // a normal (unannotated) transaction: flows through applyTextEdit like
    // any user edit, keeping one code path
    this.cm.dispatch({
      changes: { from: 0, to: this.cm.state.doc.length, insert: text },
    })
  }

  refreshDocumentState(changedLabel: Label | null): void {
    const err = this.engine.parseError()
    if (err) {
      this.store.setStale(err, this.dirtyAncestors())
    } else if (this.engine.getView() === null) {
      this.store.setEmpty()
    } else {
      this.store.setDocument(this.engine.getView(), changedLabel, this.engine.nodeCount())
    }
  }

  get editorView(): EditorView | null {
    return this.cm
  }

  private guarded(f: () => void): void {
    if (this.reentrant) {
      console.warn('SyncController: re-entrant dispatch suppressed')
      return
    }
    this.reentrant = true
    try {
      f()
    } finally {
      this.reentrant = false
    }
  }
}

function findByLabel(
  v: import('../../engine').JsonView,
  label: Label,
): import('../../engine').JsonView | null {
  if (v.label === label) return v
  if (v.kind === 'object') {
    for (const e of v.entries) {
      const hit = findByLabel(e.value, label)
      if (hit) return hit
    }
  } else if (v.kind === 'array') {
    for (const item of v.items) {
      const hit = findByLabel(item, label)
      if (hit) return hit
    }
  }
  return null
}
