import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const KEY = 'bidi.split'

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(KEY))
      return Number.isFinite(v) && v >= 15 && v <= 85 ? v : 50
    } catch {
      return 50
    }
  })
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(ratio))
    } catch {
      /* private mode etc. */
    }
  }, [ratio])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setRatio(Math.max(15, Math.min(85, pct)))
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }, [])

  return (
    <div className="split" ref={root} style={{ gridTemplateColumns: `${ratio}% 6px 1fr` }}>
      <div className="split-pane">{left}</div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setRatio((r) => Math.max(15, r - 2))
          if (e.key === 'ArrowRight') setRatio((r) => Math.min(85, r + 2))
        }}
      />
      <div className="split-pane">{right}</div>
    </div>
  )
}
