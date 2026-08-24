/**
 * Bridges the EditorSession facade to the UI's Engine contract.
 *
 * JsonView is a cheap projection of ViewTerm, memoized per node in a
 * WeakMap — structural sharing in ViewTerm therefore yields object identity
 * in JsonView, which the UI's memoized rendering relies on.
 */

import type { Path } from './core/label'
import { zoom } from './core/term'
import { EditorSession, ViewEditBlockedError } from './session'

export { ViewEditBlockedError }
import type { ViewTerm } from './json/view'
import { deleteChild, insertChild, moveChild, replaceValue, setScalar } from './json/edits'
import type {
  Engine,
  JsonKind,
  JsonView,
  Label,
  ParseErrorView,
  Span,
  TextChange,
  TextEditResult,
  ViewEdit,
  ViewEditResult,
} from './types'

const projMemo = new WeakMap<ViewTerm, JsonView>()

function project(v: ViewTerm): JsonView {
  const hit = projMemo.get(v)
  if (hit) return hit
  let out: JsonView
  switch (v.data.kind) {
    case 'VObject':
      out = {
        label: v.label,
        kind: 'object',
        entries: v.children.map((m) => {
          const key = m.children[0]
          if (key.data.kind !== 'VString') throw new Error('project: malformed member')
          return { keyLabel: key.label, key: key.data.value, value: project(m.children[1]) }
        }),
      }
      break
    case 'VArray':
      out = { label: v.label, kind: 'array', items: v.children.map(project) }
      break
    case 'VString':
      out = { label: v.label, kind: 'string', value: v.data.value }
      break
    case 'VNumber':
      out = { label: v.label, kind: 'number', value: v.data.value }
      break
    case 'VBool':
      out = { label: v.label, kind: 'boolean', value: v.data.value }
      break
    case 'VNull':
      out = { label: v.label, kind: 'null' }
      break
    case 'VMember':
      throw new Error('project: bare member')
  }
  projMemo.set(v, out)
  return out
}

export function defaultForType(kind: JsonKind): unknown {
  switch (kind) {
    case 'string':
      return ''
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'object':
      return {}
    case 'array':
      return []
  }
}

export class SessionEngine implements Engine {
  private session: EditorSession

  constructor(initialText: string) {
    this.session = EditorSession.fromText(initialText)
  }

  getText(): string {
    return this.session.text
  }

  getView(): JsonView | null {
    return this.session.view ? project(this.session.view) : null
  }

  isDirty(): boolean {
    return this.session.state.kind === 'dirty'
  }

  applyTextEdit(changes: TextChange[]): TextEditResult {
    // apply end-to-start so earlier coordinates stay valid
    const sorted = [...changes].sort((a, b) => b.from - a.from)
    let changedLabel: Label | null = null
    for (const c of sorted) {
      const r = this.session.applyTextEdit(c)
      if (r.viewPatch) changedLabel = r.viewPatch.newNode.label
    }
    return {
      view: this.getView(),
      changedLabel,
      parseError: this.parseError(),
    }
  }

  applyViewEdit(edit: ViewEdit): ViewEditResult {
    const e = this.toEditP(edit)
    const r = this.session.applyViewEdit(e)
    return {
      textChanges: r.textEdit ? [r.textEdit] : [],
      view: this.getView(),
    }
  }

  private pathOf(l: Label): Path {
    const p = this.session.viewPathOfLabel(l)
    if (p === null) throw new Error(`unknown label ${l}`)
    return p
  }

  private toEditP(edit: ViewEdit) {
    const alloc = this.session.freshLabels()
    switch (edit.type) {
      case 'setScalar':
        return setScalar(this.pathOf(edit.label), edit.value)
      case 'renameKey':
        // the key slot is child 0 of its member; the keyLabel path points at it
        return setScalar(this.pathOf(edit.keyLabel), edit.newKey)
      case 'insertMember':
        return insertChild(
          this.pathOf(edit.parentLabel),
          edit.index,
          { key: edit.key, value: edit.value },
          alloc,
        )
      case 'insertItem':
        return insertChild(this.pathOf(edit.parentLabel), edit.index, { item: edit.value }, alloc)
      case 'remove': {
        const { parentPath, index } = this.containerSlot(edit.label)
        return deleteChild(parentPath, index)
      }
      case 'changeType':
        return replaceValue(this.pathOf(edit.label), defaultForType(edit.newType), alloc)
      case 'move': {
        const { parentPath, index, count } = this.containerSlot(edit.label)
        const to = Math.max(0, Math.min(count - 1, index + edit.delta))
        return moveChild(parentPath, index, to)
      }
    }
  }

  /** For a value label, the containing container's path and the child index
   * (for object values: the member's index within the object). */
  private containerSlot(l: Label): { parentPath: Path; index: number; count: number } {
    const view = this.session.view
    if (!view) throw new Error('no document')
    const p = this.pathOf(l)
    if (p.length === 0) throw new Error('cannot remove/move the root')
    const parent = zoom(view, p.slice(0, -1))
    if (parent.data.kind === 'VMember') {
      // value inside a member -> operate on the member within the object
      const memberPath = p.slice(0, -1)
      const objPath = memberPath.slice(0, -1)
      const obj = zoom(view, objPath)
      return {
        parentPath: objPath,
        index: memberPath[memberPath.length - 1],
        count: obj.children.length,
      }
    }
    return {
      parentPath: p.slice(0, -1),
      index: p[p.length - 1],
      count: parent.children.length,
    }
  }

  spanOfLabel(l: Label): Span | null {
    return this.session.spanOfLabel(l)
  }

  labelAtOffset(off: number): Label | null {
    const raw = this.session.labelAtOffset(off)
    if (raw === null) return null
    return this.normalizeToUiLabel(raw)
  }

  labelPathAtOffset(off: number): Label[] {
    return this.session
      .labelPathAtOffset(off)
      .map((l) => this.normalizeToUiLabel(l))
      .filter((l, i, arr) => arr.indexOf(l) === i)
  }

  ancestorsOf(l: Label): Label[] {
    const p = this.session.viewPathOfLabel(l)
    const view = this.session.view
    if (p === null || view === null) return []
    const out: Label[] = []
    let cur = view
    out.push(this.normalizeToUiLabel(cur.label))
    for (const i of p) {
      cur = cur.children[i]
      const norm = this.normalizeToUiLabel(cur.label)
      if (out[out.length - 1] !== norm) out.push(norm)
    }
    return out
  }

  /** Member labels never surface in JsonView (rows are keyed by the value
   * node); map a VMember label to its value child's label. */
  private normalizeToUiLabel(l: Label): Label {
    const node = this.session.viewNodeOfLabel(l)
    if (node && node.data.kind === 'VMember') return node.children[1].label
    return l
  }

  parseError(): ParseErrorView | null {
    return this.session.parseError()
  }

  /** While the text is unparseable: the UI label of the subtree containing
   * the broken region (null = not attributable below the root). */
  dirtyLabel(): Label | null {
    const raw = this.session.dirtyLabel()
    return raw === null ? null : this.normalizeToUiLabel(raw)
  }

  nodeCount(): number {
    const v = this.session.view
    if (!v) return 0
    let n = 0
    const walk = (t: ViewTerm): void => {
      if (t.data.kind !== 'VMember') n++
      t.children.forEach(walk)
    }
    walk(v)
    return n
  }
}
