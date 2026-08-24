import { useMemo } from 'react'
import { SessionEngine } from './engine'
import { UiStore } from './ui/store/uiStore'
import { SyncController } from './ui/sync/SyncController'
import { TextPane } from './ui/codemirror/TextPane'
import { TreeView } from './ui/tree/TreeView'
import { SplitPane } from './ui/shell/SplitPane'
import { Toolbar } from './ui/shell/Toolbar'
import { StatusBar } from './ui/shell/StatusBar'
import { Breadcrumb } from './ui/shell/Breadcrumb'
import { defaultCollapsed } from './ui/tree/flatten'
import { defaultSample } from './ui/samples/samples'

export function App() {
  const { controller, store, initialText } = useMemo(() => {
    const initialText = defaultSample
    const engine = new SessionEngine(initialText)
    const store = new UiStore()
    const controller = new SyncController(engine, store)
    store.setCollapsedAll(defaultCollapsed(engine.getView()))
    store.setDocument(engine.getView(), null, engine.nodeCount())
    return { controller, store, initialText }
  }, [])

  return (
    <div className="app">
      <Toolbar controller={controller} store={store} />
      <SplitPane
        left={<TextPane controller={controller} initialText={initialText} />}
        right={
          <>
            <Breadcrumb controller={controller} store={store} />
            <TreeView controller={controller} store={store} />
          </>
        }
      />
      <StatusBar store={store} />
    </div>
  )
}
