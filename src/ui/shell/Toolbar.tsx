import { useEffect, useState } from 'react'
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import type { SyncController } from '../sync/SyncController'
import type { UiStore } from '../store/uiStore'
import { useUiStore } from '../store/uiStore'
import { samples } from '../samples/samples'

export function Toolbar({ controller, store }: { controller: SyncController; store: UiStore }) {
  const stale = useUiStore(store, (s) => s.stale)
  const viewVersion = useUiStore(store, (s) => s.viewVersion)
  const [histDepths, setHistDepths] = useState({ undo: 0, redo: 0 })

  useEffect(() => {
    const cm = controller.editorView
    if (cm) setHistDepths({ undo: undoDepth(cm.state), redo: redoDepth(cm.state) })
  }, [viewVersion, stale, controller])

  const format = (): void => {
    const cm = controller.editorView
    if (!cm || stale) return
    try {
      const pretty = JSON.stringify(JSON.parse(controller.engine.getText()), null, 2)
      controller.loadText(pretty)
    } catch {
      /* stale guard already covers this */
    }
  }

  return (
    <div className="toolbar">
      <span className="toolbar-title">bidirectional json</span>
      <select
        className="toolbar-select"
        title="Load sample"
        value=""
        onChange={(e) => {
          const s = samples.find((x) => x.name === e.target.value)
          if (s) controller.loadText(s.text)
          e.target.value = ''
        }}
      >
        <option value="" disabled>
          Load sample…
        </option>
        {samples.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="toolbar-btn" onClick={format} disabled={stale} title="Reformat the whole document">
        Format
      </button>
      <span className="toolbar-spacer" />
      <button
        className="toolbar-btn"
        disabled={histDepths.undo === 0}
        onClick={() => controller.editorView && undo(controller.editorView)}
        title="Undo (⌘Z)"
      >
        ↩ Undo
      </button>
      <button
        className="toolbar-btn"
        disabled={histDepths.redo === 0}
        onClick={() => controller.editorView && redo(controller.editorView)}
        title="Redo (⇧⌘Z)"
      >
        ↪ Redo
      </button>
    </div>
  )
}
