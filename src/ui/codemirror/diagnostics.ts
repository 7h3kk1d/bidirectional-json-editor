/** Parse-error squiggles via @codemirror/lint's imperative API. */

import { setDiagnostics } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import type { ParseErrorView } from '../../engine'

export function pushDiagnostics(view: EditorView, err: ParseErrorView | null): void {
  if (err === null) {
    view.dispatch(setDiagnostics(view.state, []))
    return
  }
  const docLen = view.state.doc.length
  const from = Math.min(err.span.from, Math.max(0, docLen - 1))
  const to = Math.max(Math.min(err.span.to, docLen), Math.min(from + 1, docLen))
  view.dispatch(
    setDiagnostics(view.state, [
      { from, to: Math.max(to, from), severity: 'error', message: err.message },
    ]),
  )
}
