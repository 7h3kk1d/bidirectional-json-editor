/**
 * EditorSession — the sole stateful facade tying both directions together.
 *
 *   text edits  --(incremental reparse + local re-get)-->  view      (Dir 2)
 *   view edits  --(change-based putᶜʰ -> local putˢᵗ)  -->  text edit (Dir 1)
 *
 * Deliberate symmetry: view edits go THROUGH the CST and come back as text
 * edits for the editor; text edits go through reparse and come back as view
 * patches.
 *
 * Dirty protocol: when the text is momentarily unparseable, the last-good
 * CST/view stay frozen; every subsequent edit is queued and recovery is
 * retried; span/label queries answer in last-good coordinates remapped
 * through the pending edits. View edits are rejected while dirty.
 */

import { LabelAllocator, LabelRegistry } from './core/label'
import type { Label, Path } from './core/label'
import { labels, zoom } from './core/term'
import { putCh } from './core/put'
import { mcp } from './core/mcp'
import type { EditP } from './core/edit'
import type { SrcTerm } from './json/cst'
import { srcOps } from './json/cst'
import type { VData, ViewTerm } from './json/view'
import { viewIdentical, viewOps } from './json/view'
import { buildRegistries, getFold } from './json/get'
import { parse } from './json/parser'
import { render } from './json/render'
import { transferLabels } from './json/relabel'
import { detectFormat, lineIndentAt } from './json/format'
import type { FormatContext } from './json/format'
import { jsonPutSt } from './json/putSt'
import { applyEdit, mapPos, mapPosBack } from './incremental/changeset'
import type { TextEdit } from './incremental/changeset'
import { labelToSpan, offsetToPath, pathToSpan } from './incremental/spans'
import type { Span } from './incremental/spans'
import { applyTextEditToCst } from './incremental/reparse'
import type { ViewPatch } from './incremental/reparse'

export interface ParseErrorInfo {
  pos: number
  expected: string
}

export type SyncState =
  | { kind: 'clean' }
  | { kind: 'empty' } // no value in the document (blank text)
  | {
      kind: 'dirty'
      pending: TextEdit[]
      lastError: ParseErrorInfo
      /** the broken region, in LAST-GOOD (clean) coordinates — the union of
       * all pending edits mapped back; view edits are allowed only strictly
       * outside it */
      envelope: { min: number; max: number }
    }

/** A structured edit was refused because its alignment position overlaps the
 * broken text region. The caller should treat this as a no-op. */
export class ViewEditBlockedError extends Error {
  constructor() {
    super('view edit overlaps the unparsed (dirty) region')
  }
}

export interface TextUpdateResult {
  view: ViewTerm | null
  viewPatch: ViewPatch | null
  state: SyncState
}

export interface ViewUpdateResult {
  textEdit: TextEdit | null
  viewPatch: ViewPatch | null
}

const DEV_ASSERT = true

export class EditorSession {
  text: string
  view: ViewTerm | null = null
  state: SyncState = { kind: 'empty' }

  private cst: SrcTerm | null = null
  private cleanText = ''
  private srcReg = new LabelRegistry()
  private viewReg = new LabelRegistry()
  private readonly alloc = new LabelAllocator()
  private fmt: FormatContext

  private constructor(text: string) {
    this.text = text
    this.fmt = detectFormat(text)
  }

  static fromText(text: string): EditorSession {
    const s = new EditorSession(text)
    s.fullParse()
    return s
  }

  /** Parse this.text from scratch, transferring labels from any previous CST. */
  private fullParse(): void {
    const r = parse(this.text, 'document', this.alloc)
    if (r.ok && r.consumed === this.text.length) {
      let doc = r.terms[0]
      if (this.cst) doc = transferLabels(this.cst, doc)
      const view = getFold(doc)
      const { srcReg, viewReg } = buildRegistries(doc, view)
      this.cst = doc
      this.view = view
      this.srcReg = srcReg
      this.viewReg = viewReg
      this.cleanText = this.text
      this.state = { kind: 'clean' }
    } else if (/^[ \t\r\n]*$/.test(this.text)) {
      this.cst = null
      this.view = null
      this.state = { kind: 'empty' }
      this.cleanText = this.text
    } else {
      const err: ParseErrorInfo = r.ok
        ? { pos: r.consumed, expected: 'end of input' }
        : { pos: r.pos, expected: r.expected }
      if (this.state.kind === 'dirty') this.state = { ...this.state, lastError: err }
      else
        this.state = {
          kind: 'dirty',
          pending: [],
          lastError: err,
          envelope: { min: 0, max: this.text.length },
        }
    }
  }

  // ---- Direction 2: text edits -------------------------------------------

  /** Apply one text edit (coordinates in the CURRENT text). */
  applyTextEdit(edit: TextEdit): TextUpdateResult {
    const newText = applyEdit(this.text, edit)
    this.text = newText

    if (this.state.kind === 'dirty') {
      // widen the broken region by this edit, mapped back to clean coords
      const min = mapPosBack(this.state.pending, edit.from, -1)
      const max = mapPosBack(this.state.pending, edit.to, 1)
      this.state.envelope.min = Math.min(this.state.envelope.min, min)
      this.state.envelope.max = Math.max(this.state.envelope.max, max)
      this.state.pending.push(edit)
      return this.retryRecovery()
    }
    if (this.state.kind === 'empty' || this.cst === null || this.view === null) {
      this.fullParse()
      return { view: this.view, viewPatch: this.view ? { path: [], oldNode: this.view, newNode: this.view } : null, state: this.state }
    }

    const r = applyTextEditToCst({
      cst: this.cst,
      newText,
      edit,
      alloc: this.alloc,
      srcReg: this.srcReg,
      viewReg: this.viewReg,
      view: this.view,
    })
    if (r.ok) {
      this.cst = r.cst
      this.view = r.view
      this.cleanText = newText
      this.state = { kind: 'clean' }
      if (DEV_ASSERT && render(this.cst) !== newText) {
        throw new Error('engine invariant: render(cst) !== text after reparse')
      }
      return { view: this.view, viewPatch: r.viewPatch, state: this.state }
    }
    if (/^[ \t\r\n]*$/.test(newText)) {
      this.cst = null
      this.view = null
      this.cleanText = newText
      this.state = { kind: 'empty' }
      return { view: null, viewPatch: null, state: this.state }
    }
    this.state = {
      kind: 'dirty',
      pending: [edit],
      lastError: r.error,
      envelope: { min: edit.from, max: edit.to },
    }
    return { view: this.view, viewPatch: null, state: this.state }
  }

  private retryRecovery(): TextUpdateResult {
    // Full-document reparse with whole-tree label transfer. Dirty periods are
    // brief; O(n) per keystroke while syntactically invalid is acceptable.
    const r = parse(this.text, 'document', this.alloc)
    if (r.ok && r.consumed === this.text.length) {
      const doc = this.cst ? transferLabels(this.cst, r.terms[0]) : r.terms[0]
      const vNew = getFold(doc)
      const oldView = this.view
      const patch: ViewPatch | null =
        oldView && viewIdentical(oldView, vNew)
          ? null
          : { path: [], oldNode: oldView ?? vNew, newNode: vNew }
      const { srcReg, viewReg } = buildRegistries(doc, patch === null && oldView ? oldView : vNew)
      this.cst = doc
      this.view = patch === null && oldView ? oldView : vNew
      this.srcReg = srcReg
      this.viewReg = viewReg
      this.cleanText = this.text
      this.state = { kind: 'clean' }
      return { view: this.view, viewPatch: patch, state: this.state }
    }
    if (/^[ \t\r\n]*$/.test(this.text)) {
      this.cst = null
      this.view = null
      this.cleanText = this.text
      this.state = { kind: 'empty' }
      return { view: null, viewPatch: null, state: this.state }
    }
    const err: ParseErrorInfo = r.ok
      ? { pos: r.consumed, expected: 'end of input' }
      : { pos: r.pos, expected: r.expected }
    if (this.state.kind === 'dirty') this.state = { ...this.state, lastError: err }
    else
      this.state = {
        kind: 'dirty',
        pending: [],
        lastError: err,
        envelope: { min: 0, max: this.text.length },
      }
    return { view: this.view, viewPatch: null, state: this.state }
  }

  // ---- Direction 1: view edits ---------------------------------------------

  applyViewEdit(e: EditP<VData>): ViewUpdateResult {
    if (this.cst === null || this.view === null) {
      throw new Error('applyViewEdit: no document')
    }
    const cst = this.cst
    const view = this.view
    // The put runs against the LAST-GOOD state; while dirty, the current text
    // differs from it by the pending edits, and the produced text edit is
    // rebased across them below.
    const cleanText = this.state.kind === 'dirty' ? this.cleanText : this.text

    if (this.state.kind === 'dirty') {
      // Pre-compute the alignment position (putCh steps 1-2, without the
      // registry mutations) and refuse edits whose rewritten span touches the
      // broken region.
      const affPath = e.affect(e.path, view)
      const u = zoom(view, affPath)
      const paths: Path[] = []
      for (const l of labels(u)) {
        const lp = this.srcReg.locate(l)
        if (lp !== null) paths.push(lp)
      }
      const span = pathToSpan(cst, mcp(paths))
      const env = this.state.envelope
      // blocked iff the rewritten span OVERLAPS the broken region;
      // touching at a boundary is fine (the rebase below handles it)
      if (span.to > env.min && span.from < env.max) throw new ViewEditBlockedError()
    }

    const result = putCh(
      {
        sOps: srcOps,
        vOps: viewOps,
        get: getFold,
        srcReg: this.srcReg,
        viewReg: this.viewReg,
        alloc: this.alloc,
      },
      (args) =>
        jsonPutSt({
          ...args,
          fmt: this.fmt,
          alloc: this.alloc,
          baseIndent: lineIndentAt(cleanText, pathToSpan(cst, args.sourcePath).from),
        }),
      e,
      cst,
      view,
    )

    if (result.newFocus === result.oldFocus) {
      // nothing actually changed
      return { textEdit: null, viewPatch: null }
    }

    const span = pathToSpan(cst, result.sourcePath)
    const cleanEdit: TextEdit = { from: span.from, to: span.to, insert: render(result.newFocus) }
    let currentEdit: TextEdit = cleanEdit

    if (this.state.kind === 'dirty') {
      const env = this.state.envelope
      const before = cleanEdit.to <= env.min
      if (DEV_ASSERT && !before && !(cleanEdit.from >= env.max)) {
        throw new Error('engine invariant: pre-check let an overlapping dirty edit through')
      }
      const delta = cleanEdit.insert.length - (cleanEdit.to - cleanEdit.from)
      if (before) {
        // the edit lands before every pending edit: shift them (and the
        // envelope, which lives in clean coordinates)
        this.state.pending = this.state.pending.map((p) => ({
          from: p.from + delta,
          to: p.to + delta,
          insert: p.insert,
        }))
        env.min += delta
        env.max += delta
        // no pending edit precedes it, so current coords = clean coords
        currentEdit = cleanEdit
      } else {
        // after every pending edit: map its position forward through them
        currentEdit = {
          from: mapPos(this.state.pending, cleanEdit.from, 1),
          to: mapPos(this.state.pending, cleanEdit.to, 1),
          insert: cleanEdit.insert,
        }
      }
      this.cst = result.source
      this.view = result.view
      this.cleanText = applyEdit(cleanText, cleanEdit)
      this.text = applyEdit(this.text, currentEdit)
      if (DEV_ASSERT && render(this.cst) !== this.cleanText) {
        throw new Error('engine invariant: render(cst) !== cleanText after dirty view edit')
      }
    } else {
      this.cst = result.source
      this.view = result.view
      this.text = applyEdit(cleanText, cleanEdit)
      this.cleanText = this.text
      if (DEV_ASSERT && render(this.cst) !== this.text) {
        throw new Error('engine invariant: render(cst) !== text after view edit')
      }
    }

    const patch: ViewPatch = {
      path: result.viewPath,
      oldNode: result.oldViewFocus,
      newNode: result.newViewFocus,
    }
    return { textEdit: currentEdit, viewPatch: patch }
  }

  // ---- queries (all remap through pending edits while dirty) ---------------

  private toClean(off: number): number {
    return this.state.kind === 'dirty' ? mapPosBack(this.state.pending, off) : off
  }

  private fromClean(off: number, assoc: -1 | 1 = -1): number {
    return this.state.kind === 'dirty' ? mapPos(this.state.pending, off, assoc) : off
  }

  spanOfLabel(l: Label): Span | null {
    if (this.cst === null) return null
    const s = labelToSpan(this.cst, this.srcReg, l)
    if (!s) return null
    return { from: this.fromClean(s.from, -1), to: this.fromClean(s.to, 1) }
  }

  /** Labels along the path at `off`, outermost first, view nodes only. */
  labelPathAtOffset(off: number): Label[] {
    if (this.cst === null) return []
    const clean = this.toClean(off)
    const best = this.viewLabelsAt(clean, 'right')
    const alt = this.viewLabelsAt(clean, 'left')
    return alt.length > best.length ? alt : best
  }

  private viewLabelsAt(off: number, bias: 'left' | 'right'): Label[] {
    if (this.cst === null) return []
    const p = offsetToPath(this.cst, off, bias)
    const out: Label[] = []
    let cur = this.cst
    if (this.viewReg.has(cur.label)) out.push(cur.label)
    for (const i of p) {
      cur = cur.children[i]
      if (this.viewReg.has(cur.label)) out.push(cur.label)
    }
    return out
  }

  labelAtOffset(off: number): Label | null {
    const p = this.labelPathAtOffset(off)
    return p.length > 0 ? p[p.length - 1] : null
  }

  viewPathOfLabel(l: Label): Path | null {
    return this.viewReg.locate(l)
  }

  viewNodeOfLabel(l: Label): ViewTerm | null {
    if (this.view === null) return null
    const p = this.viewReg.locate(l)
    return p === null ? null : zoom(this.view, p)
  }

  /** While dirty: the broken region in CURRENT text coordinates. A view node
   * is locked exactly when its span overlaps this (open intervals) — the same
   * rule applyViewEdit blocks on, so the UI can gray precisely what is
   * actually uneditable. */
  dirtySpan(): Span | null {
    if (this.state.kind !== 'dirty') return null
    const env = this.state.envelope
    return {
      from: mapPos(this.state.pending, env.min, -1),
      to: mapPos(this.state.pending, env.max, 1),
    }
  }

  /** The exact blocking predicate, per node: while dirty, a node is locked
   * iff its (last-good) span overlaps the broken envelope — the same test
   * applyViewEdit rejects on, evaluated in the same clean coordinates (a
   * current-coordinate test would collapse to nothing for pure deletions). */
  isLocked(l: Label): boolean {
    if (this.state.kind !== 'dirty') return false
    if (this.cst === null) return true
    const p = this.srcReg.locate(l)
    if (p === null) return true
    const span = pathToSpan(this.cst, p)
    const env = this.state.envelope
    return span.to > env.min && span.from < env.max
  }

  parseError(): { span: Span; message: string } | null {
    if (this.state.kind !== 'dirty') return null
    const pos = Math.min(this.state.lastError.pos, this.text.length)
    return {
      span: { from: pos, to: Math.min(pos + 1, this.text.length) },
      message: `expected ${this.state.lastError.expected}`,
    }
  }

  /** Test hook: verify internal consistency. */
  checkInvariants(): void {
    if (this.state.kind === 'clean' && this.cst) {
      if (render(this.cst) !== this.text) throw new Error('render mismatch')
      if (this.view) {
        for (const l of labels(this.view)) {
          const p = this.viewReg.locate(l)
          if (p === null || zoom(this.view, p).label !== l) throw new Error('view registry broken')
        }
      }
      for (const l of labels(this.cst)) {
        const p = this.srcReg.locate(l)
        if (p === null || zoom(this.cst, p).label !== l) throw new Error('src registry broken')
      }
    }
    void this.cleanText
  }

  freshLabels(): LabelAllocator {
    return this.alloc
  }
}
