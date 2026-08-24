import { useEffect, useRef, useState } from 'react'
import type { JsonView } from '../../engine'

/** Inline scalar editor: Enter/blur commits, Esc cancels, Tab commits and
 * lets the tree advance. Invalid numbers shake and stay in edit mode. */
export function ValueEditor({
  node,
  onCommit,
  onCancel,
  onTab,
}: {
  node: JsonView
  onCommit: (value: string | number | boolean | null) => void
  onCancel: () => void
  onTab: (back: boolean) => void
}) {
  const initial =
    node.kind === 'string'
      ? node.value
      : node.kind === 'number'
        ? String(node.value)
        : node.kind === 'boolean'
          ? String(node.value)
          : 'null'
  const [text, setText] = useState(initial)
  const [invalid, setInvalid] = useState(false)
  const ref = useRef<HTMLInputElement | null>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const parse = (): { ok: boolean; value?: string | number | boolean | null } => {
    switch (node.kind) {
      case 'string':
        return { ok: true, value: text }
      case 'number': {
        const n = Number(text.trim())
        if (text.trim() === '' || !Number.isFinite(n)) return { ok: false }
        return { ok: true, value: n }
      }
      case 'boolean': {
        const t = text.trim().toLowerCase()
        if (t === 'true') return { ok: true, value: true }
        if (t === 'false') return { ok: true, value: false }
        return { ok: false }
      }
      default:
        return { ok: true, value: null }
    }
  }

  const commit = (viaTab: boolean, back = false): void => {
    if (done.current) return
    const r = parse()
    if (!r.ok) {
      setInvalid(true)
      ref.current?.focus()
      setTimeout(() => setInvalid(false), 400)
      return
    }
    done.current = true
    onCommit(r.value!)
    if (viaTab) onTab(back)
  }

  return (
    <input
      ref={ref}
      className={`tree-input ${invalid ? 'tree-input--invalid' : ''}`}
      value={text}
      size={Math.max(4, text.length + 1)}
      onChange={(e) => setText(e.target.value)}
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
  )
}
