export const STYLES = /* css */ `
  :host {
    all: initial;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
    font-size: 12px;
    color: #d4d4d8;
    line-height: 1.5;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* ── Floating toggle button ── */

  .floating-icon {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  .floating-icon:hover {
    background: #27272a;
    transform: translateX(-50%) translateY(-2px);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(var(--accent-rgb), 0.3);
  }

  .floating-icon svg {
    width: 18px;
    height: 18px;
    fill: var(--accent);
  }

  /* ── Docked panel ── */

  .panel-wrapper {
    z-index: 2147483646;
  }

  .panel {
    width: 100%;
    height: 100%;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Resize handle ── */

  .resize-handle {
    position: absolute;
    z-index: 1;
    background: transparent;
    transition: background 0.15s;
    touch-action: none;
  }

  .resize-handle:hover,
  .resize-handle:active {
    background: rgba(var(--accent-rgb), 0.4);
  }

  .resize-handle-bottom {
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    cursor: ns-resize;
  }

  .resize-handle-left {
    top: 0;
    right: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
  }

  .resize-handle-right {
    top: 0;
    left: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
  }

  /* ── Panel header ── */

  .panel-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .panel-close {
    background: none;
    border: none;
    color: #71717a;
    cursor: pointer;
    font-size: 18px;
    padding: 2px 6px;
    border-radius: 6px;
    line-height: 1;
    transition: all 0.15s;
  }

  .panel-close:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #d4d4d8;
  }

  /* ── Header controls (dock buttons + close) ── */

  .panel-header-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .dock-btn {
    background: none;
    border: none;
    color: #71717a;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .dock-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #a1a1aa;
  }

  .dock-btn.active {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
  }

  .dock-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ── Panel body ── */

  .panel-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .tree-pane {
    flex: 1;
    overflow: hidden;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .detail-pane {
    flex-shrink: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 12px 14px;
    position: relative;
  }

  .detail-resize-handle {
    position: absolute;
    z-index: 1;
    background: transparent;
    transition: background 0.15s;
    touch-action: none;
  }

  .detail-resize-handle:hover,
  .detail-resize-handle:active {
    background: rgba(var(--accent-rgb), 0.4);
  }

  /* ── Vertical layout (side-docked) ── */

  .panel-body-vertical {
    flex-direction: column;
  }

  .panel-body-vertical .tree-pane {
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex: 1;
  }

  .panel-body-vertical .detail-pane {
    width: 100%;
    flex-shrink: 0;
    min-height: 60px;
  }

  .detail-pane-empty {
    color: #52525b;
    font-style: italic;
    padding-top: 40px;
    text-align: center;
    font-size: 11px;
  }

  /* ── Detail panel ── */

  .detail-section {
    margin-bottom: 14px;
  }

  .detail-component-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 6px;
  }

  .detail-section-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .detail-row {
    display: flex;
    gap: 8px;
    padding: 2px 0;
  }

  .detail-key {
    color: color-mix(in srgb, var(--accent) 70%, white);
    flex-shrink: 0;
  }

  .detail-key-clickable {
    cursor: pointer;
    transition: color 0.15s;
  }

  .detail-key-clickable:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .detail-value {
    color: #86efac;
    word-break: break-all;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail-value.string {
    color: #fbbf24;
  }

  .detail-value.number {
    color: #86efac;
  }

  .detail-value.boolean {
    color: #60a5fa;
  }

  .detail-expand-toggle {
    cursor: pointer;
    color: #71717a;
    font-size: 8px;
    margin-right: 4px;
    user-select: none;
    display: inline-block;
    width: 10px;
  }

  .detail-expand-toggle:hover {
    color: #a1a1aa;
  }

  .detail-object-preview {
    color: #a1a1aa;
    cursor: pointer;
  }

  .detail-object-preview:hover {
    color: #d4d4d8;
  }

  .detail-object-expanded {
    padding-left: 14px;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    margin-top: 2px;
    margin-left: 2px;
  }

  .detail-object-entry {
    display: flex;
    gap: 8px;
    padding: 1px 0;
  }

  .hook-type-tag {
    color: rgba(var(--accent-rgb), 0.6);
    font-size: 0.9em;
    margin-left: 6px;
  }

  .source-label {
    color: #71717a;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 6px;
    margin-bottom: 2px;
  }

  .source-link-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }

  .source-link {
    color: #a1a1aa;
    font-size: 11px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .source-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .source-copy-btn {
    background: none;
    border: none;
    color: #52525b;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .source-copy-btn:hover {
    color: #a1a1aa;
    background: rgba(255, 255, 255, 0.06);
  }

  /* ── Search bar ── */

  .search-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .search-icon {
    width: 13px;
    height: 13px;
    color: #52525b;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #d4d4d8;
    font-size: 11px;
    font-family: inherit;
    padding: 2px 4px;
    min-width: 0;
  }

  .search-input::placeholder {
    color: #52525b;
  }

  .search-bar-btn {
    background: none;
    border: none;
    color: #52525b;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .search-bar-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #a1a1aa;
  }

  .search-bar-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ── Tree nodes ── */

  .tree-node {
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }

  .tree-node-row {
    display: flex;
    align-items: center;
    padding: 2px 10px 2px 8px;
    gap: 2px;
    transition: background 0.1s;
  }

  .tree-node-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .tree-node-row.selected {
    background: rgba(var(--accent-rgb), 0.25);
  }

  .tree-node-toggle {
    width: 16px;
    flex-shrink: 0;
    text-align: center;
    color: #52525b;
    font-size: 9px;
  }

  .tree-node-name {
    color: #67e8f9;
  }

  .tree-node-name.from-node-modules {
    color: #52525b;
  }

  .tree-node-name.search-match {
    background: rgba(var(--accent-rgb), 0.2);
    border-radius: 2px;
    padding: 0 2px;
  }

  .tree-node-prop-name {
    color: #c4b5fd;
  }

  .tree-node-prop-eq {
    color: #a1a1aa;
  }

  .tree-node-prop-value {
    color: #fbbf24;
  }

  .tree-node-prop-overflow {
    color: #71717a;
    font-size: 0.9em;
  }

  .tree-node-collapsed-count {
    color: #3f3f46;
    font-size: 10px;
    margin-left: 4px;
  }

  .tree-node-children {
    margin-left: 8px;
    padding-left: 6px;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* ── Context menu ── */

  .context-menu {
    position: fixed;
    z-index: 2147483647;
    background: #27272a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 4px;
    min-width: 200px;
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  .context-menu-item {
    padding: 7px 12px;
    cursor: pointer;
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: #d4d4d8;
    font-size: 12px;
    font-family: inherit;
    text-align: left;
    border-radius: 6px;
    transition: background 0.1s;
  }

  .context-menu-item:hover {
    background: rgba(var(--accent-rgb), 0.15);
  }

  /* ── Highlight overlay ── */

  .highlight-overlay {
    position: fixed;
    z-index: 2147483645;
    pointer-events: none;
    background: rgba(var(--accent-rgb), 0.08);
    border: 1.5px solid rgba(var(--accent-rgb), 0.5);
    border-radius: 4px;
    transition: all 0.1s ease-out;
  }

  .highlight-label {
    position: absolute;
    top: -22px;
    left: 0;
    background: var(--accent);
    color: white;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap;
    font-weight: 500;
  }

  /* ── Tab bar ── */

  .tab-bar {
    display: flex;
    padding: 0 16px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    gap: 0;
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #a1a1aa;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    padding: 8px 14px;
    transition: all 0.15s;
  }

  .tab-btn:hover {
    color: #a1a1aa;
  }

  .tab-btn.tab-active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-badge {
    background: #ef4444;
    color: white;
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 8px;
    margin-left: 6px;
    font-weight: 600;
  }

  /* ── Console pane ── */

  .console-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .console-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .console-toolbar-spacer {
    flex: 1;
  }

  .console-filter-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    padding: 3px 10px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .console-filter-btn:hover {
    border-color: rgba(255, 255, 255, 0.15);
    color: #a1a1aa;
  }

  .console-filter-btn.filter-active {
    background: rgba(var(--accent-rgb), 0.12);
    border-color: rgba(var(--accent-rgb), 0.2);
    color: color-mix(in srgb, var(--accent) 60%, white);
  }

  .console-action-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    padding: 3px 10px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .console-action-btn:hover {
    border-color: rgba(255, 255, 255, 0.15);
    color: #a1a1aa;
  }

  .console-entries {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 0;
  }

  .console-entry {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    transition: background 0.1s;
  }

  .console-entry:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .console-entry-icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin-top: 1px;
  }

  .console-entry-icon.error {
    color: #ef4444;
  }

  .console-entry-icon.warning {
    color: #f59e0b;
  }

  .console-entry-time {
    color: #71717a;
    font-size: 10px;
    flex-shrink: 0;
    min-width: 50px;
    margin-top: 1px;
  }

  .console-entry-content {
    flex: 1;
    min-width: 0;
  }

  .console-entry-message {
    color: #d4d4d8;
    word-break: break-word;
  }

  .console-entry.error .console-entry-message {
    color: #fca5a5;
  }

  .console-entry.warning .console-entry-message {
    color: #fcd34d;
  }

  .console-entry-stack {
    color: #a1a1aa;
    font-size: 10px;
    margin-top: 4px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .console-entry-copy {
    background: none;
    border: none;
    color: #71717a;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .console-entry:hover .console-entry-copy {
    opacity: 1;
  }

  .console-entry-copy:hover {
    color: #a1a1aa;
    background: rgba(255, 255, 255, 0.06);
  }

  .console-empty {
    color: #52525b;
    font-style: italic;
    padding: 40px 20px;
    text-align: center;
    font-size: 11px;
  }

  /* ── Settings popover ── */

  .settings-popover {
    position: absolute;
    top: 100%;
    right: 16px;
    z-index: 10;
    background: #27272a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 8px;
    min-width: 220px;
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  .settings-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    cursor: pointer;
    border-radius: 6px;
    font-size: 12px;
    transition: background 0.1s;
    user-select: none;
  }

  .settings-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .settings-checkbox {
    width: 16px;
    height: 16px;
    border: 1.5px solid #52525b;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    flex-shrink: 0;
    transition: all 0.15s;
    color: transparent;
  }

  .settings-checkbox.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .settings-font-size {
    justify-content: space-between;
  }

  .settings-font-btns {
    display: flex;
    gap: 2px;
  }

  .settings-font-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
    padding: 2px 6px;
    border-radius: 4px;
    min-width: 24px;
    transition: all 0.15s;
  }

  .settings-font-btn:hover {
    border-color: rgba(255, 255, 255, 0.15);
    color: #d4d4d8;
  }

  .settings-font-btn.active {
    background: rgba(var(--accent-rgb), 0.12);
    border-color: rgba(var(--accent-rgb), 0.2);
    color: var(--accent);
  }

  .settings-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 10px;
  }

  .settings-editor {
    justify-content: space-between;
  }

  .settings-select {
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #d4d4d8;
    font-size: 11px;
    font-family: inherit;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .settings-select:hover {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .settings-select:focus {
    border-color: rgba(var(--accent-rgb), 0.4);
  }

  .settings-custom-input {
    flex: 1;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #d4d4d8;
    font-size: 11px;
    font-family: inherit;
    padding: 4px 8px;
    border-radius: 4px;
    outline: none;
    width: 100%;
  }

  .settings-custom-input::placeholder {
    color: #52525b;
  }

  .settings-custom-input:focus {
    border-color: rgba(var(--accent-rgb), 0.4);
  }

  .settings-editor-hint {
    padding: 2px 10px 6px;
    font-size: 10px;
  }

  .settings-editor-hint a {
    color: #52525b;
    text-decoration: none;
    transition: color 0.15s;
  }

  .settings-editor-hint a:hover {
    color: var(--accent);
  }

  /* ── Scrollbar ── */

  ::-webkit-scrollbar {
    width: 5px;
    height: 5px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: #3f3f46;
    border-radius: 3px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #52525b;
  }
`
