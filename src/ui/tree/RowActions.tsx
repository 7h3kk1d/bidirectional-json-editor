export function RowActions({
  canAdd,
  canRemove,
  onAdd,
  onRemove,
}: {
  canAdd: boolean
  canRemove: boolean
  onAdd?: () => void
  onRemove?: () => void
}) {
  return (
    <span className="tree-actions">
      {canAdd && (
        <button
          className="tree-btn"
          title="Add child at start"
          onClick={(e) => {
            e.stopPropagation()
            onAdd?.()
          }}
        >
          +
        </button>
      )}
      {canRemove && (
        <button
          className="tree-btn tree-btn--danger"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove?.()
          }}
        >
          −
        </button>
      )}
    </span>
  )
}
