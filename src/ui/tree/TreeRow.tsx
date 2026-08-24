import { memo } from 'react'
import type { JsonKind } from '../../engine'
import type { FlatRow } from './flatten'
import { previewOf } from '../lib/jsonDefaults'
import { ValueEditor } from './ValueEditor'
import { KeyEditor } from './KeyEditor'
import { TypeSelect } from './TypeSelect'
import { RowActions } from './RowActions'

export interface RowHandlers {
  onFocus(row: FlatRow): void
  onToggle(row: FlatRow): void
  onBeginEdit(row: FlatRow, field: 'key' | 'value'): void
  onCommitKey(row: FlatRow, key: string): void
  onCommitValue(row: FlatRow, value: string | number | boolean | null): void
  onCancelEdit(): void
  onTabEdit(row: FlatRow, field: 'key' | 'value', back: boolean): void
  onChangeType(row: FlatRow, kind: JsonKind): void
  onAddChild(row: FlatRow): void
  onRemove(row: FlatRow): void
  siblingKeysOf(row: FlatRow): string[]
}

interface Props {
  row: FlatRow
  top: number
  rowStale: boolean
  isCaret: boolean
  isSelected: boolean
  isAncestor: boolean
  isFocus: boolean
  isCollapsed: boolean
  editingField: 'key' | 'value' | null
  disabled: boolean
  h: RowHandlers
}

export const TreeRow = memo(function TreeRow({
  row,
  top,
  rowStale,
  isCaret,
  isSelected,
  isAncestor,
  isFocus,
  isCollapsed,
  editingField,
  disabled,
  h,
}: Props) {
  const isContainer = row.kind === 'object' || row.kind === 'array'
  const isScalar = !isContainer
  const cls = [
    'tree-row',
    rowStale ? 'row--stale' : '',
    isSelected ? 'row--selected' : '',
    isCaret ? 'row--caret' : '',
    isAncestor && !isSelected ? 'row--ancestor' : '',
    isFocus ? 'row--focus' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{ top, paddingLeft: 8 + row.depth * 16 }}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={isContainer ? !isCollapsed : undefined}
      tabIndex={isFocus ? 0 : -1}
      data-label={row.label}
      onClick={() => h.onFocus(row)}
      onDoubleClick={(e) => {
        e.preventDefault()
        if (!disabled && isScalar) h.onBeginEdit(row, 'value')
      }}
    >
      {isContainer ? (
        <button
          className="tree-chevron"
          aria-hidden
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            h.onToggle(row)
          }}
        >
          {isCollapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="tree-chevron tree-chevron--none" />
      )}

      {row.key !== null &&
        (editingField === 'key' ? (
          <KeyEditor
            initial={row.key}
            siblingKeys={h.siblingKeysOf(row)}
            onCommit={(k) => h.onCommitKey(row, k)}
            onCancel={h.onCancelEdit}
            onTab={(back) => h.onTabEdit(row, 'key', back)}
          />
        ) : (
          <span
            className="tree-key"
            onDoubleClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              if (!disabled) h.onBeginEdit(row, 'key')
            }}
          >
            {JSON.stringify(row.key)}
          </span>
        ))}
      {row.key !== null && <span className="tree-colon">:</span>}
      {row.key === null && row.index !== null && <span className="tree-index">{row.index}</span>}

      {editingField === 'value' && isScalar ? (
        <ValueEditor
          node={row.node}
          onCommit={(v) => h.onCommitValue(row, v)}
          onCancel={h.onCancelEdit}
          onTab={(back) => h.onTabEdit(row, 'value', back)}
        />
      ) : (
        <span
          className={`tree-value tree-value--${row.kind}`}
          onDoubleClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (!disabled && isScalar) h.onBeginEdit(row, 'value')
          }}
        >
          {previewOf(row.node)}
        </span>
      )}

      {!disabled && (
        <span className="tree-row__tools">
          <TypeSelect
            kind={row.kind}
            destructive={isContainer && row.childCount > 0}
            onChange={(k) => h.onChangeType(row, k)}
          />
          <RowActions
            canAdd={isContainer}
            canRemove={row.parent !== null}
            onAdd={() => h.onAddChild(row)}
            onRemove={() => h.onRemove(row)}
          />
        </span>
      )}
    </div>
  )
})
