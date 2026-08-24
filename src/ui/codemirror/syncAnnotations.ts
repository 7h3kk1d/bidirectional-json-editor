/**
 * Transaction annotations that break the sync feedback loops:
 *  - 'engine': doc changes produced by applyViewEdit (struct-side edits) —
 *    the updateListener must NOT feed them back into applyTextEdit;
 *  - 'mirror': selection/decoration dispatches that merely reflect
 *    struct-pane state — the listener must not map them back again.
 * Absence of the annotation = genuine user input in the text pane.
 */

import { Annotation } from '@codemirror/state'

export type SyncOrigin = 'engine' | 'mirror'

export const syncOrigin = Annotation.define<SyncOrigin>()
