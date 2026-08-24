import { useEffect, useRef, useState } from 'react'

/** Inline key editor with duplicate-key validation against siblings. */
export function KeyEditor({
  initial,
  siblingKeys,
  onCommit,
  onCancel,
  onTab,
}: {
  initial: string
  siblingKeys: readonly string[]
  onCommit: (key: string) => void
  onCancel: () => void
  onTab: (back: boolean) => void
}) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement | null>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (viaTab: boolean, back = false): void => {
    if (done.current) return
    if (text !== initial && siblingKeys.includes(text)) {
      setError('duplicate key')
      ref.current?.focus()
      return
    }
    done.current = true
    onCommit(text)
    if (viaTab) onTab(back)
  }

  return (
    <span className="tree-keyedit">
      <input
        ref={ref}
        className={`tree-input ${error ? 'tree-input--invalid' : ''}`}
        value={text}
        size={Math.max(3, text.length + 1)}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(false)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            done.current = true
            onCancel()
          } else if (e.key === 'Tab') {
            e.preventDefault()
            commit(true, e.shiftKey)
          }
          e.stopPropagation()
        }}
      />
      {error && <span className="tree-keyedit__err">{error}</span>}
    </span>
  )
}
