/**
 * CodeMirror theme wired to the app's CSS custom properties, so both panes
 * flip together with the OS color scheme — no JS theme logic.
 */

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const cmTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: 'var(--mono)',
    caretColor: 'var(--fg)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    {
      background: 'var(--sel-bg)',
    },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-soft)',
    color: 'var(--fg-dim)',
    border: 'none',
    fontFamily: 'var(--mono)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--line-hl)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--line-hl)' },
  '&.cm-focused': { outline: 'none' },
})

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syn-key)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-atom)' },
  { tag: tags.null, color: 'var(--syn-atom)' },
  { tag: tags.punctuation, color: 'var(--fg-dim)' },
  { tag: tags.brace, color: 'var(--fg-dim)' },
  { tag: tags.squareBracket, color: 'var(--fg-dim)' },
])

export const appHighlighting = syntaxHighlighting(highlight)
