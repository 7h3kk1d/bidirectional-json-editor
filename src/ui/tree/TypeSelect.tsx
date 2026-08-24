import type { JsonKind } from '../../engine'

const KINDS: JsonKind[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

export function TypeSelect({
  kind,
  destructive,
  onChange,
}: {
  kind: JsonKind
  destructive: boolean
  onChange: (k: JsonKind) => void
}) {
  return (
    <select
      className="tree-typeselect"
      value={kind}
      title="Change type"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value as JsonKind
        if (next === kind) return
        if (destructive && !window.confirm('Replace this non-empty container? Its contents will be lost.')) {
          e.target.value = kind
          return
        }
        onChange(next)
      }}
    >
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  )
}
