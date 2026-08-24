import type { UiStore } from '../store/uiStore'
import { useUiStore } from '../store/uiStore'
import { jsonPathOf } from '../lib/paths'

export function StatusBar({ store }: { store: UiStore }) {
  const view = useUiStore(store, (s) => s.view)
  const caretPath = useUiStore(store, (s) => s.caretPath)
  const stale = useUiStore(store, (s) => s.stale)
  const parseError = useUiStore(store, (s) => s.parseError)
  const caretPos = useUiStore(store, (s) => s.caretPos)
  const nodeCount = useUiStore(store, (s) => s.nodeCount)

  return (
    <div className="statusbar">
      <span className="statusbar-path">{jsonPathOf(view, caretPath) || ' '}</span>
      <span className={`statusbar-msg ${stale ? 'statusbar-msg--error' : ''}`}>
        {stale && parseError ? parseError.message : ''}
      </span>
      <span className="statusbar-right">
        Ln {caretPos.line}, Col {caretPos.col} · {nodeCount.toLocaleString()} nodes
      </span>
    </div>
  )
}
