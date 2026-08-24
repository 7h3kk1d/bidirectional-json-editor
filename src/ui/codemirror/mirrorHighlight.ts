/**
 * Mirrored decorations in the text pane, driven by struct-pane state.
 *
 * A StateField (not a ViewPlugin): the decorations are pure functions of
 * dispatched effects, must survive and remap through document changes
 * deterministically (RangeSet.map), and are not viewport-dependent.
 */

import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import type { Span } from '../../engine'

export const setNodeHighlight = StateEffect.define<{ span: Span; ancestors: Span[] } | null>()
export const setGhostCaret = StateEffect.define<number | null>()

const nodeMark = Decoration.mark({ class: 'cm-mirror-node' })
const ancestorMark = Decoration.mark({ class: 'cm-mirror-ancestor' })

class GhostCaretWidget extends WidgetType {
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-ghost-caret'
    return s
  }
  eq(): boolean {
    return true
  }
  ignoreEvent(): boolean {
    return true
  }
}

const ghostCaret = Decoration.widget({ widget: new GhostCaretWidget(), side: 1 })

interface MirrorState {
  highlight: DecorationSet
  ghost: DecorationSet
}

export const mirrorHighlightField = StateField.define<MirrorState>({
  create: () => ({ highlight: Decoration.none, ghost: Decoration.none }),
  update(state, tr) {
    let highlight = state.highlight.map(tr.changes)
    let ghost = state.ghost.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setNodeHighlight)) {
        if (e.value === null) {
          highlight = Decoration.none
        } else {
          const ranges = []
          for (const a of e.value.ancestors) {
            if (a.to > a.from) ranges.push(ancestorMark.range(a.from, a.to))
          }
          const { from, to } = e.value.span
          if (to > from) ranges.push(nodeMark.range(from, to))
          highlight = Decoration.set(ranges, true)
        }
      }
      if (e.is(setGhostCaret)) {
        ghost = e.value === null ? Decoration.none : Decoration.set([ghostCaret.range(e.value)])
      }
    }
    return { highlight, ghost }
  },
  provide: (f) => [
    EditorView.decorations.from(f, (s) => s.highlight),
    EditorView.decorations.from(f, (s) => s.ghost),
  ],
})
