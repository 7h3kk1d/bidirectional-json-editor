// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history } from '@codemirror/commands'
import { SessionEngine } from '../../src/engine'
import { UiStore } from '../../src/ui/store/uiStore'
import { SyncController } from '../../src/ui/sync/SyncController'
import { mirrorHighlightField } from '../../src/ui/codemirror/mirrorHighlight'
import { syncOrigin } from '../../src/ui/codemirror/syncAnnotations'

const SAMPLE = '{\n  "a": 1,\n  "b": [true, null],\n  "c": "hi"\n}'

function makeApp(text = SAMPLE) {
  const engine = new SessionEngine(text)
  const store = new UiStore()
  const controller = new SyncController(engine, store)
  store.setDocument(engine.getView(), null, engine.nodeCount())
  const view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        mirrorHighlightField,
        EditorView.updateListener.of((u) => controller.onCmUpdate(u)),
      ],
    }),
    parent: document.body,
  })
  controller.attachEditor(view)
  return { engine, store, controller, view }
}

describe('SyncController', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('text typing flows into the engine and updates the store (path A)', () => {
    const { engine, store, view } = makeApp()
    const off = SAMPLE.indexOf('1')
    view.dispatch({ changes: { from: off, to: off + 1, insert: '42' } })
    expect(engine.getText()).toBe(view.state.doc.toString())
    expect(store.getSnapshot().stale).toBe(false)
    const v = store.getSnapshot().view!
    expect(v.kind).toBe('object')
    if (v.kind === 'object') expect(v.entries[0].value).toMatchObject({ kind: 'number', value: 42 })
  })

  it('struct edits dispatch engine-annotated transactions and do NOT loop (loop #1)', () => {
    const { engine, store, controller, view } = makeApp()
    let applyCount = 0
    const origApply = engine.applyTextEdit.bind(engine)
    engine.applyTextEdit = (changes) => {
      applyCount++
      return origApply(changes)
    }
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    const label = v.entries[0].value.label
    let engineAnnotated = 0
    const origDispatch = view.dispatch.bind(view)
    ;(view as { dispatch: typeof view.dispatch }).dispatch = ((spec: unknown) => {
      const tr = view.state.update(spec as Parameters<typeof view.state.update>[0])
      if (tr.annotation(syncOrigin) === 'engine') engineAnnotated++
      return origDispatch(spec as Parameters<typeof view.dispatch>[0])
    }) as typeof view.dispatch
    controller.dispatchViewEdit({ type: 'setScalar', label, value: 99 })
    expect(engineAnnotated).toBe(1)
    expect(applyCount).toBe(0) // the engine transaction did not re-enter applyTextEdit
    expect(view.state.doc.toString()).toContain('"a": 99')
    expect(engine.getText()).toBe(view.state.doc.toString())
  })

  it('mirror highlights do not re-trigger selection mapping (loop #2)', () => {
    const { store, controller } = makeApp()
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    const before = store.getSnapshot().caretPath
    controller.focusLabel(v.entries[1].value.label, { scroll: false })
    expect(store.getSnapshot().caretPath).toBe(before)
    expect(store.getSnapshot().structFocus).toBe(v.entries[1].value.label)
  })

  it('selection mapping: caret and range map to the right rows (incl. to-1 boundary)', () => {
    const { engine, store, view } = makeApp()
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    const aValue = v.entries[0].value
    const span = engine.spanOfLabel(aValue.label)!
    view.dispatch({ selection: { anchor: span.from } })
    const caretPath = store.getSnapshot().caretPath
    expect(caretPath[caretPath.length - 1]).toBe(aValue.label)
    view.dispatch({ selection: { anchor: span.from, head: span.to } })
    const selPath = store.getSnapshot().selectionPath
    expect(selPath[selPath.length - 1]).toBe(aValue.label)
    const bSpan = engine.spanOfLabel(v.entries[1].value.label)!
    view.dispatch({ selection: { anchor: span.from, head: bSpan.to } })
    const wide = store.getSnapshot().selectionPath
    expect(wide[wide.length - 1]).toBe(v.label)
  })

  it('parse errors mark the store stale and keep the last-good view', () => {
    const { store, controller, view } = makeApp()
    const goodView = store.getSnapshot().view
    const closeIdx = view.state.doc.toString().lastIndexOf('}')
    view.dispatch({ changes: { from: closeIdx, to: closeIdx + 1, insert: '' } })
    expect(store.getSnapshot().stale).toBe(true)
    expect(store.getSnapshot().view).toBe(goodView)
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: '}' } })
    expect(store.getSnapshot().stale).toBe(false)
    void controller
  })

  it('while dirty, edits outside the broken subtree apply; overlapping ones are refused', () => {
    const { engine, store, controller, view } = makeApp()
    // break "b"'s array: delete the comma inside [true, null]
    const commaIdx = view.state.doc.toString().indexOf('true,') + 4
    view.dispatch({ changes: { from: commaIdx, to: commaIdx + 1, insert: '' } })
    expect(store.getSnapshot().stale).toBe(true)
    expect(store.getSnapshot().dirtyAncestors.length).toBeGreaterThan(0)
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    // "a" is outside the broken subtree: edit applies, text updates, still dirty
    controller.dispatchViewEdit({ type: 'setScalar', label: v.entries[0].value.label, value: 5 })
    expect(engine.getText()).toContain('"a": 5')
    expect(engine.getText()).toBe(view.state.doc.toString())
    expect(store.getSnapshot().stale).toBe(true)
    // "b" overlaps the broken region: refused, nothing changes
    const before = engine.getText()
    controller.dispatchViewEdit({ type: 'setScalar', label: v.entries[1].value.label, value: 0 })
    expect(engine.getText()).toBe(before)
    // heal the array and confirm both panes converge
    const healAt = view.state.doc.toString().indexOf('true') + 4
    view.dispatch({ changes: { from: healAt, to: healAt, insert: ',' } })
    expect(store.getSnapshot().stale).toBe(false)
    expect(engine.getText()).toContain('"a": 5')
    expect(engine.getText()).toContain('[true, null]')
  })

  it('undo of a struct edit flows back through applyTextEdit (loop #4 is a feature)', async () => {
    const { engine, store, controller, view } = makeApp()
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    const label = v.entries[0].value.label
    controller.dispatchViewEdit({ type: 'setScalar', label, value: 777 })
    expect(view.state.doc.toString()).toContain('777')
    const { undo } = await import('@codemirror/commands')
    undo(view)
    expect(view.state.doc.toString()).toBe(SAMPLE)
    expect(engine.getText()).toBe(SAMPLE)
    const restored = store.getSnapshot().view!
    if (restored.kind !== 'object') throw new Error('bad view')
    expect(restored.entries[0].value).toMatchObject({ kind: 'number', value: 1 })
  })

  it('insertMember + renameKey through the controller update text with preserved formatting', () => {
    const { engine, store, controller } = makeApp('{\n  "a": 1\n}')
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    const newLabel = controller.dispatchViewEdit({
      type: 'insertMember',
      parentLabel: v.label,
      index: 1,
      key: 'b',
      value: null,
    })
    expect(newLabel).not.toBeNull()
    expect(engine.getText()).toBe('{\n  "a": 1,\n  "b": null\n}')
    const v2 = store.getSnapshot().view!
    if (v2.kind !== 'object') throw new Error('bad view')
    controller.dispatchViewEdit({ type: 'renameKey', keyLabel: v2.entries[1].keyLabel, newKey: 'bee' })
    expect(engine.getText()).toBe('{\n  "a": 1,\n  "bee": null\n}')
  })

  it('remove and changeType address object members correctly', () => {
    const { engine, store, controller } = makeApp('{ "x": "hi", "y": [1, 2] }')
    const v = store.getSnapshot().view!
    if (v.kind !== 'object') throw new Error('bad view')
    controller.dispatchViewEdit({ type: 'changeType', label: v.entries[0].value.label, newType: 'array' })
    expect(engine.getText()).toBe('{ "x": [], "y": [1, 2] }')
    const v2 = store.getSnapshot().view!
    if (v2.kind !== 'object') throw new Error('bad view')
    controller.dispatchViewEdit({ type: 'remove', label: v2.entries[1].value.label })
    expect(engine.getText()).toBe('{ "x": [] }')
  })
})
