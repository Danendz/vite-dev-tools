# Keyboard Tree Navigation

## Problem

The component tree in the devtools overlay has no keyboard navigation. Users must use the mouse to select, expand, and collapse tree nodes. This makes the tool less accessible and slower for keyboard-oriented workflows.

## Solution

Add standard tree keyboard navigation (matching VS Code / Chrome DevTools patterns) to the TreeView component.

### Keybindings

| Key | Action |
|-----|--------|
| Up | Move selection to previous visible node |
| Down | Move selection to next visible node |
| Left | Collapse current node, or move to parent if already collapsed/leaf |
| Right | Expand current node, or move to first child if already expanded/leaf |
| Enter | Select node (show in detail panel) and scroll into view |

### Architecture Change: Lift Collapse State

**Current**: Each `TreeNode` manages its own `collapsed` boolean via local `useState`. External signals (collapse-all, expand-all, search ancestors, picker expand) are communicated via effects that watch prop changes (`collapseTarget`/`collapseVersion`, `expandedNodeIds`, `searchAncestorIds`).

**New**: `TreeView` manages a single `collapsedSet: Set<string>` containing IDs of collapsed nodes. `TreeNode` becomes a controlled component receiving `isCollapsed` and `onToggle` props.

Benefits:
- TreeView can compute a flat visible node list for Up/Down navigation
- Collapse-all and expand-all become trivial set operations
- Picker expand and search ancestor expand directly modify the set
- Single source of truth for collapse state

### Flat Visible List

TreeView computes `flatVisibleNodes: NormalizedNode[]` from the tree, doing a depth-first walk that skips children of collapsed nodes. This list is used for Up/Down index arithmetic.

### Focus Management

- Tree scroll container gets `tabIndex={0}` for focusability
- Keyboard selection maps directly to `onSelect` — no separate "focused but not selected" state. Arrow keys select immediately (matching Chrome DevTools behavior).
- Clicking a node or using the picker also updates the keyboard cursor position
- On keyboard nav, the focused row scrolls into view with `block: 'nearest'`

### Default Collapse State

Nodes where `isFromNodeModules` is true start collapsed. All others start expanded. This preserves current behavior.

## Files to Modify

- `src/core/overlay/TreeView.tsx` — collapse state Set, flat list computation, keydown handler, tabIndex, remove collapseTarget/collapseVersion props, add onToggle callback
- `src/core/overlay/TreeNode.tsx` — remove local collapse useState, receive isCollapsed/onToggle as props, remove collapseTarget/collapseVersion/expandedNodeIds/searchAncestorIds effect handlers
- `src/core/overlay/App.tsx` — remove collapseTarget/collapseVersion state, simplify handleCollapseAll/handleExpandAll, pass new props
- `src/core/overlay/Panel.tsx` — update prop passthrough
- `src/core/overlay/styles.ts` — focus outline for tree container

## Verification

1. `pnpm build` passes
2. In test app: click the tree area, then use Up/Down to navigate nodes
3. Left collapses an expanded node, second Left jumps to parent
4. Right expands a collapsed node, second Right jumps to first child
5. Enter selects and scrolls detail panel
6. Collapse-all and expand-all buttons still work
7. Search still auto-expands ancestor nodes
8. Picker still expands path to picked node
9. Mouse clicking still works as before
