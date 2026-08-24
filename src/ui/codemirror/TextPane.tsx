import { useEffect, useRef } from 'react'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { lintGutter } from '@codemirror/lint'
import type { SyncController } from '../sync/SyncController'
import { mirrorHighlightField } from './mirrorHighlight'
import { appHighlighting, cmTheme } from './cmTheme'

export function TextPane({ controller, initialText }: { controller: SyncController; initialText: string }) {
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: initialText,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lineNumbers(),
          drawSelection(),
          bracketMatching(),
          json(),
          appHighlighting,
          lintGutter(),
          mirrorHighlightField,
          cmTheme,
          EditorView.updateListener.of((u) => controller.onCmUpdate(u)),
        ],
      }),
      parent: host.current,
    })
    controller.attachEditor(view)
    return () => {
      controller.detachEditor()
      view.destroy()
    }
    // the controller and initial text are stable for the app's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="textpane" ref={host} />
}
