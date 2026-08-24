import type { SyncController } from '../sync/SyncController'
import type { UiStore } from '../store/uiStore'
import { useUiStore } from '../store/uiStore'
import { pathSegments } from '../lib/paths'

export function Breadcrumb({ controller, store }: { controller: SyncController; store: UiStore }) {
  const view = useUiStore(store, (s) => s.view)
  const caretPath = useUiStore(store, (s) => s.caretPath)
  const selectionPath = useUiStore(store, (s) => s.selectionPath)
  const path = selectionPath.length > 0 ? selectionPath : caretPath
  const segs = pathSegments(view, path)

  return (
    <div className="breadcrumb" aria-label="path">
      {segs.length === 0 ? (
        <span className="breadcrumb-empty">—</span>
      ) : (
        segs.map((seg, i) => (
          <button
            key={i}
            className="breadcrumb-seg"
            onClick={() => {
              store.revealPath(segs.slice(0, i + 1).map((x) => x.label))
              controller.focusLabel(seg.label, { scroll: true })
            }}
          >
            {seg.text}
          </button>
        ))
      )}
    </div>
  )
}
