/**
 * The UI-facing engine contract. The UI never touches Terms or registries —
 * it sees labeled JsonView trees, spans, and label-addressed edits.
 */

export type Label = number

export interface Span {
  from: number
  to: number
}

export type JsonView =
  | { label: Label; kind: 'object'; entries: { keyLabel: Label; key: string; value: JsonView }[] }
  | { label: Label; kind: 'array'; items: JsonView[] }
  | { label: Label; kind: 'string'; value: string }
  | { label: Label; kind: 'number'; value: number }
  | { label: Label; kind: 'boolean'; value: boolean }
  | { label: Label; kind: 'null' }

export type JsonKind = JsonView['kind']

export type ViewEdit =
  | { type: 'setScalar'; label: Label; value: string | number | boolean | null }
  | { type: 'renameKey'; keyLabel: Label; newKey: string }
  | { type: 'insertMember'; parentLabel: Label; index: number; key: string; value: unknown }
  | { type: 'insertItem'; parentLabel: Label; index: number; value: unknown }
  | { type: 'remove'; label: Label }
  | { type: 'changeType'; label: Label; newType: JsonKind }
  | { type: 'move'; label: Label; delta: -1 | 1 }

export interface TextChange {
  from: number
  to: number
  insert: string
}

export interface ParseErrorView {
  span: Span
  message: string
}

export interface TextEditResult {
  view: JsonView | null
  changedLabel: Label | null
  parseError: ParseErrorView | null
}

export interface ViewEditResult {
  textChanges: TextChange[]
  view: JsonView | null
}

export interface Engine {
  getText(): string
  getView(): JsonView | null
  isDirty(): boolean
  applyTextEdit(changes: TextChange[]): TextEditResult
  applyViewEdit(edit: ViewEdit): ViewEditResult
  spanOfLabel(l: Label): Span | null
  labelAtOffset(off: number): Label | null
  labelPathAtOffset(off: number): Label[]
  /** root..self labels of the node (view nodes only) */
  ancestorsOf(l: Label): Label[]
  parseError(): ParseErrorView | null
  nodeCount(): number
  /** while dirty: the broken text region (current coordinates) */
  dirtySpan(): Span | null
  /** while dirty: whether structured edits on this node would be refused */
  isLocked(l: Label): boolean
}
