# Bidirectional JSON Editor

A dual-pane JSON editor: raw text (CodeMirror 6) on the left, a structured
tree editor on the right, kept consistent **incrementally in both
directions** using the techniques of Wang, Gibbons & Wu,
*Incremental Updates for Efficient Bidirectional Transformations*
(ICFP 2011 — `bidi.pdf` in this repo).

- **Source** = a concrete syntax tree of the JSON text that preserves every
  byte of formatting; **view** = the plain JSON tree; `get` is a
  label-preserving, well-aligning fold.
- **Structured edits** run the paper's change-based `putᶜʰ` (§4.2): the
  labels of the affected view subterm are collected, the `mcp` of their
  source paths locates the smallest *alignment position*, a
  formatting-preserving state-based put runs only there, and the result is
  spliced back through a one-hole context. Text outside the alignment
  position stays byte-identical.
- **Text edits** reparse only the smallest strictly-covering node, transfer
  labels onto the reparsed subtree, and re-run `get` locally.
- The same **unique labels** that drive alignment also drive the UI:
  selection/caret in either pane highlights the corresponding node/span in
  the other.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine property tests (bidirectional laws) + UI tests
```

## Layout

```
src/engine/core/         the paper's generic machinery: Term, labels,
                         one-hole contexts, zoom, mcp, EditP, putCh
src/engine/json/         the JSON instance: CST, parser, get, putSt, edits
src/engine/incremental/  text-edit direction: spans, local reparse, dirty state
src/engine/session.ts    the stateful facade tying both directions together
src/engine/adapter.ts    label-addressed Engine contract for the UI
src/ui/                  React + CodeMirror 6 dual-pane UI
```

The bidirectional laws (Consistency/Acceptability, Theorems 24–25, plus
locality) are property-tested with fast-check in `tests/engine/putlaws.test.ts`.

## Manual test script

1. Click inside `"Ada"` in the text → the `name` row is outlined, the
   breadcrumb and status bar show `$.users[0].name`.
2. Select across two array items → the deepest common ancestor is
   highlighted in the tree, its ancestors tinted.
3. Click a node in the tree → its exact text span highlights and scrolls
   into view (the caret does not move).
4. Double-click a value, type, Enter → the text updates in place;
   ⌘Z in either pane reverts both.
5. Delete a `,` in the text → only the subtree containing the broken text
   grays out; the rest of the tree stays live and editable (edits whose
   rewritten span would touch the broken region are refused). Retype the
   comma → recovers, keeping structured edits made in the meantime.
6. Rename a key to a duplicate sibling → inline error, no edit dispatched.
7. Use the type dropdown / + / − on rows: inserts clone sibling
   indentation; deletes clean up exactly one comma.
8. Load the "large (5k rows)" sample → the tree is windowed; typing stays
   responsive.
