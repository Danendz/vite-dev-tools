export const STYLES = /* css */ `
  :host {
    all: initial;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
    font-size: 12px;
    color: #d4d4d8;
    line-height: 1.5;
  }

  .devtools-root {
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
    align-items: center;
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

  .slot-indicator {
    color: #71717a;
    font-size: 10px;
    cursor: pointer;
    margin-top: 1px;
    margin-bottom: 2px;
    transition: color 0.15s;
  }
  .slot-indicator:hover {
    color: var(--accent);
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

  .tree-node-name.host-element {
    color: #71717a;
  }

  .tree-node-element-toggle {
    color: #a1a1aa;
    font-size: 9px;
    margin-right: 4px;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    user-select: none;
    background: rgba(255, 255, 255, 0.06);
  }

  .tree-node-element-toggle:hover {
    color: #e4e4e7;
    background: rgba(255, 255, 255, 0.12);
  }

  .tree-node-element-toggle.active {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.15);
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

  .tree-node-prop-overflow.clickable {
    cursor: pointer;
  }

  .tree-node-prop-overflow.clickable:hover {
    color: #a1a1aa;
    text-decoration: underline;
  }

  .tree-node-prop-value-edited {
    color: var(--accent) !important;
  }

  .tree-node-prop-clickable {
    cursor: pointer;
  }

  .tree-node-prop-clickable:hover {
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .tree-node-prop-edit-input {
    background: #18181b;
    color: #fbbf24;
    border: 1px solid var(--accent);
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
    padding: 0 3px;
    margin: 0;
    outline: none;
    width: auto;
    min-width: 30px;
    max-width: 200px;
  }

  .tree-node-prop-tooltip {
    position: absolute;
    top: -24px;
    left: 0;
    background: #27272a;
    color: #a1a1aa;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10;
    border: 1px solid #3f3f46;
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

  /* ── AI action visualization ── */

  .highlight-overlay.ai-source {
    background: rgba(168, 85, 247, 0.08);
    border-color: rgba(168, 85, 247, 0.5);
  }

  .highlight-label.ai-source {
    background: #a855f7;
  }

  .tree-node-ai-badge {
    display: inline-block;
    background: rgba(168, 85, 247, 0.15);
    color: #a855f7;
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    margin-left: 4px;
    font-weight: 600;
    vertical-align: middle;
  }

  .ai-highlight-clear-btn {
    background: rgba(168, 85, 247, 0.15);
    color: #a855f7;
    border: 1px solid rgba(168, 85, 247, 0.3);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s;
  }

  .ai-highlight-clear-btn:hover {
    background: rgba(168, 85, 247, 0.25);
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

  /* ── Settings modal ── */

  .settings-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-modal {
    background: #1c1c1e;
    border: 1px solid #3f3f46;
    border-radius: 10px;
    width: 680px;
    max-width: 90vw;
    height: 480px;
    max-height: 80vh;
    display: flex;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .settings-modal-sidebar {
    width: 160px;
    background: #18181b;
    border-right: 1px solid #3f3f46;
    padding: 12px 8px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-modal-title {
    font-size: 11px;
    font-weight: 600;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 8px 10px;
  }

  .settings-nav-item {
    background: none;
    border: none;
    color: #a1a1aa;
    font-size: 12px;
    font-family: inherit;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: all 0.1s;
  }

  .settings-nav-item:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #d4d4d8;
  }

  .settings-nav-item.active {
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent);
  }

  .settings-modal-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .settings-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #3f3f46;
    flex-shrink: 0;
  }

  .settings-modal-category-title {
    font-size: 14px;
    font-weight: 600;
    color: #e4e4e7;
  }

  .settings-modal-close {
    background: none;
    border: none;
    color: #71717a;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: all 0.1s;
  }

  .settings-modal-close:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #d4d4d8;
  }

  .settings-modal-body {
    flex: 1;
    overflow: auto;
    padding: 8px 0;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .settings-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .settings-row.settings-row-no-click {
    cursor: default;
  }

  .settings-row-info {
    flex: 1;
    min-width: 0;
  }

  .settings-row-label {
    font-size: 12px;
    font-weight: 500;
    color: #e4e4e7;
  }

  .settings-row-desc {
    font-size: 11px;
    color: #71717a;
    margin-top: 2px;
  }

  .settings-row-desc a {
    color: #71717a;
    text-decoration: none;
    transition: color 0.15s;
  }

  .settings-row-desc a:hover {
    color: var(--accent);
  }

  .settings-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    background: #3f3f46;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s;
    padding: 0;
  }

  .settings-toggle.active {
    background: rgba(var(--accent-rgb), 0.8);
  }

  .settings-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    pointer-events: none;
  }

  .settings-toggle.active .settings-toggle-thumb {
    transform: translateX(16px);
  }

  .settings-section-label {
    font-size: 11px;
    font-weight: 600;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 14px 16px 6px;
    border-top: 1px solid #3f3f46;
    margin-top: 4px;
  }

  .settings-status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 10px;
    border-radius: 12px;
    flex-shrink: 0;
  }

  .settings-status-badge.active {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
  }

  .settings-status-badge.paused {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.1);
  }

  .settings-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .settings-status-badge.active .settings-status-dot {
    background: #4ade80;
  }

  .settings-status-badge.paused .settings-status-dot {
    background: #fbbf24;
  }

  .settings-command-tabs {
    display: flex;
    gap: 2px;
    padding: 0 16px;
    margin-bottom: 8px;
  }

  .settings-command-tab {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    font-size: 11px;
    font-family: inherit;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .settings-command-tab:hover {
    border-color: rgba(255, 255, 255, 0.15);
    color: #d4d4d8;
  }

  .settings-command-tab.active {
    background: rgba(var(--accent-rgb), 0.12);
    border-color: rgba(var(--accent-rgb), 0.2);
    color: var(--accent);
  }

  .settings-command-block {
    margin: 0 16px;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    position: relative;
    overflow: hidden;
  }

  .settings-command-code {
    padding: 10px 60px 10px 12px;
    font-family: monospace;
    font-size: 11px;
    color: #d4d4d8;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
  }

  .settings-command-copy {
    position: absolute;
    top: 6px;
    right: 6px;
    background: #3f3f46;
    border: none;
    color: #a1a1aa;
    font-size: 10px;
    font-family: inherit;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .settings-command-copy:hover {
    background: #52525b;
    color: #d4d4d8;
  }

  /* ── Tree focus ── */

  .tree-scroll-container:focus-visible {
    box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.3);
  }

  /* ── Editable values ── */

  .editable-value-wrapper {
    display: inline;
  }

  .editable-value-wrapper.editable {
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: border-color 0.15s;
  }

  .editable-value-wrapper.editable:hover {
    border-bottom-color: rgba(var(--accent-rgb), 0.4);
  }

  .editable-value-wrapper.editable:hover::after {
    content: ' ✎';
    font-size: 9px;
    color: rgba(var(--accent-rgb), 0.5);
  }

  .edit-boolean-toggle:hover {
    background: rgba(var(--accent-rgb), 0.15);
    border-radius: 2px;
  }

  .edit-boolean-toggle:hover::after {
    content: ' ↔';
  }

  .edit-inline {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
  }

  .edit-input {
    background: #18181b;
    border: 1px solid rgba(var(--accent-rgb), 0.4);
    color: #d4d4d8;
    font-size: inherit;
    font-family: inherit;
    padding: 1px 4px;
    border-radius: 3px;
    outline: none;
    min-width: 60px;
    max-width: 200px;
  }

  .edit-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(var(--accent-rgb), 0.2);
  }

  .edit-textarea {
    background: #18181b;
    border: 1px solid rgba(var(--accent-rgb), 0.4);
    color: #d4d4d8;
    font-size: inherit;
    font-family: inherit;
    padding: 4px 6px;
    border-radius: 3px;
    outline: none;
    min-width: 150px;
    min-height: 60px;
    max-height: 200px;
    resize: vertical;
    width: 100%;
  }

  .edit-textarea:focus {
    border-color: var(--accent);
  }

  .edit-controls {
    display: inline-flex;
    gap: 2px;
    margin-left: 2px;
  }

  .edit-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    cursor: pointer;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1;
    transition: all 0.15s;
  }

  .edit-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #d4d4d8;
  }

  .edit-btn.confirm {
    color: #86efac;
    border-color: rgba(134, 239, 172, 0.2);
  }

  .edit-btn.confirm:hover {
    background: rgba(134, 239, 172, 0.1);
  }

  .edit-error {
    color: #ef4444;
    font-size: 10px;
    width: 100%;
  }

  .persist-btn {
    background: none;
    border: 1px solid rgba(var(--accent-rgb), 0.2);
    color: rgba(var(--accent-rgb), 0.7);
    cursor: pointer;
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 3px;
    margin-left: 4px;
    transition: all 0.15s;
  }

  .persist-btn:hover {
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent);
    border-color: rgba(var(--accent-rgb), 0.4);
  }

  .prop-edited .detail-value {
    color: var(--accent) !important;
  }

  .persist-row {
    display: block;
    margin-left: 0;
  }

  .persist-btn-lg {
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.3);
    color: var(--accent);
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    padding: 3px 10px;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .persist-btn-lg:hover {
    background: rgba(var(--accent-rgb), 0.15);
    border-color: rgba(var(--accent-rgb), 0.5);
  }

  .persist-btn-lg:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .edit-error-input {
    border-color: #ef4444 !important;
    box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2) !important;
  }

  /* ── Inline text ── */

  .tree-node-text {
    color: #6a9955;
  }

  .detail-text-fragment {
    color: #6a9955;
    cursor: text;
  }

  .detail-text-fragment.editable:hover {
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  /* ─�� Scrollbar ── */

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

  /* ── Toast notifications ── */

  @keyframes toast-slide-in-top {
    from { transform: translateY(-100%); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }

  @keyframes toast-slide-out-top {
    from { transform: translateY(0); opacity: 1; }
    to   { transform: translateY(-20px); opacity: 0; }
  }

  @keyframes toast-slide-in-left {
    from { transform: translateX(-100%); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
  }

  @keyframes toast-slide-out-left {
    from { transform: translateX(0); opacity: 1; }
    to   { transform: translateX(-100%); opacity: 0; }
  }

  @keyframes toast-slide-in-right {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
  }

  @keyframes toast-slide-out-right {
    from { transform: translateX(0); opacity: 1; }
    to   { transform: translateX(100%); opacity: 0; }
  }

  .toast-container {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  /* Bottom dock → bottom-right */
  .toast-container.dock-bottom {
    bottom: 16px;
    right: 16px;
    flex-direction: column-reverse;
  }

  /* Left dock → top-left */
  .toast-container.dock-left {
    top: 16px;
    left: 16px;
  }

  /* Right dock → top-right */
  .toast-container.dock-right {
    top: 16px;
    right: 16px;
  }

  .toast {
    pointer-events: auto;
    background: #27272a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 10px 14px;
    max-width: 400px;
    min-width: 260px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: toast-slide-in-top 0.3s ease-out forwards;
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .toast.dismissing {
    animation: toast-slide-out-top 0.3s ease-in forwards;
  }

  .dock-bottom .toast { animation-name: toast-slide-in-top; }
  .dock-bottom .toast.dismissing { animation-name: toast-slide-out-top; }

  .dock-left .toast { animation-name: toast-slide-in-left; }
  .dock-left .toast.dismissing { animation-name: toast-slide-out-left; }

  .dock-right .toast { animation-name: toast-slide-in-right; }
  .dock-right .toast.dismissing { animation-name: toast-slide-out-right; }

  .toast.error {
    border-left: 3px solid #ef4444;
  }

  .toast.warning {
    border-left: 3px solid #f59e0b;
  }

  .toast-icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin-top: 1px;
  }

  .toast-icon.error { color: #ef4444; }
  .toast-icon.warning { color: #f59e0b; }

  .toast-message {
    flex: 1;
    font-size: 11px;
    line-height: 1.4;
    color: #d4d4d8;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }

  .toast-dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: #71717a;
    cursor: pointer;
    padding: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .toast-dismiss:hover {
    color: #d4d4d8;
    background: rgba(255, 255, 255, 0.08);
  }

  /* ---- Preview Modal ---- */

  .preview-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-modal {
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    min-width: 380px;
    max-width: 600px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .preview-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #3f3f46;
    font-size: 12px;
  }

  .preview-modal-filename {
    color: #a1a1aa;
    font-family: monospace;
  }

  .preview-modal-line {
    color: #71717a;
    font-size: 11px;
  }

  .preview-diff {
    padding: 10px 14px;
    overflow: auto;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre;
  }

  .preview-diff-context {
    color: #71717a;
  }

  .preview-diff-removed {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.12);
    margin: 0 -14px;
    padding: 0 14px;
  }

  .preview-diff-added {
    color: #86efac;
    background: rgba(34, 197, 94, 0.12);
    margin: 0 -14px;
    padding: 0 14px;
  }

  .preview-modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 10px 14px;
    border-top: 1px solid #3f3f46;
  }

  .preview-modal-btn {
    border: none;
    border-radius: 5px;
    padding: 5px 14px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }

  .preview-modal-btn.confirm {
    background: rgba(var(--accent-rgb), 0.8);
    color: #fff;
  }

  .preview-modal-btn.confirm:hover {
    background: rgba(var(--accent-rgb), 1);
  }

  .preview-modal-btn.cancel {
    background: #3f3f46;
    color: #a1a1aa;
  }

  .preview-modal-btn.cancel:hover {
    background: #52525b;
    color: #d4d4d8;
  }

  /* ---- Saved text ---- */

  .saved-text {
    font-size: 11px;
    color: #4ade80;
  }

  /* ---- Undo button ---- */

  .undo-btn {
    border: none;
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
    margin-left: 6px;
  }

  .undo-btn:hover {
    background: rgba(251, 191, 36, 0.3);
  }

  /* ── Tooltip ── */

  @keyframes tooltip-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .tooltip-wrapper {
    position: relative;
    display: inline-flex;
  }

  .tree-node-name .tooltip-wrapper {
    display: inline;
  }

  .tooltip-chip {
    position: fixed;
    z-index: 2147483647;
    background: #1e1e1e;
    color: #fff;
    font-size: 11px;
    font-weight: 400;
    padding: 4px 8px;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: tooltip-fade-in 100ms ease-out;
    line-height: 1.3;
  }

  .tooltip-shortcut {
    color: #888;
    margin-left: 6px;
    font-size: 10px;
  }

  /* ----- Render-cause attribution ----- */

  .tree-cause-pip {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin: 0 6px 0 2px;
    flex: 0 0 auto;
    vertical-align: middle;
  }
  .tree-cause-pip.cause-mount    { background: #4ade80; }
  .tree-cause-pip.cause-state    { background: #a855f7; }
  .tree-cause-pip.cause-context  { background: #fb923c; }
  .tree-cause-pip.cause-props    { background: #60a5fa; }
  .tree-cause-pip.cause-parent   { background: #6b7280; }
  .tree-cause-pip.cause-bailout  { background: #374151; }

  @keyframes cause-pulse {
    0%  { transform: scale(1); }
    40% { transform: scale(1.8); }
    100% { transform: scale(1); }
  }
  .tree-cause-pip.cause-animate {
    animation: cause-pulse 300ms ease-out;
  }

  .detail-why {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px 4px;
  }
  .detail-why-primary {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .detail-why-primary-label {
    font-weight: 600;
    font-size: 12px;
  }
  .detail-why-commit {
    margin-left: auto;
    color: #888;
    font-size: 10px;
  }
  .detail-why-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11px;
    line-height: 1.5;
  }
  .detail-why-row-label {
    color: #aaa;
    flex: 0 0 auto;
  }
  .detail-why-row-keys {
    color: var(--accent);
    font-family: monospace;
  }
  .detail-why-hint {
    color: #888;
    font-size: 11px;
    line-height: 1.5;
    padding: 4px 0;
  }
  .detail-why-hint code {
    background: rgba(var(--accent-rgb), 0.1);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 10px;
  }

  /* ----- Renders pane ----- */

  .renders-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .renders-toolbar {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    align-items: center;
    border-bottom: 1px solid #222;
    flex-wrap: wrap;
  }
  .renders-btn {
    background: #181818;
    border: 1px solid #333;
    color: #eee;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .renders-btn:hover { background: #222; }
  .renders-btn.is-recording { border-color: rgba(var(--accent-rgb), 0.6); }
  .renders-btn.is-recording .renders-btn-dot {
    background: #ef4444;
    animation: renders-rec-pulse 1.5s ease-in-out infinite;
  }
  .renders-btn-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #555;
  }
  @keyframes renders-rec-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .renders-filters {
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .renders-chip {
    background: transparent;
    border: 1px solid #333;
    color: #888;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    cursor: pointer;
    text-transform: capitalize;
  }
  .renders-chip.is-on {
    color: #eee;
    border-color: rgba(var(--accent-rgb), 0.5);
    background: rgba(var(--accent-rgb), 0.1);
  }
  .renders-chip.cause-mount.is-on    { border-color: #4ade80; background: rgba(74, 222, 128, 0.1); color: #4ade80; }
  .renders-chip.cause-state.is-on    { border-color: #a855f7; background: rgba(168, 85, 247, 0.1); color: #a855f7; }
  .renders-chip.cause-context.is-on  { border-color: #fb923c; background: rgba(251, 146, 60, 0.1); color: #fb923c; }
  .renders-chip.cause-props.is-on    { border-color: #60a5fa; background: rgba(96, 165, 250, 0.1); color: #60a5fa; }
  .renders-chip.cause-parent.is-on   { border-color: #6b7280; background: rgba(107, 114, 128, 0.1); color: #9ca3af; }
  .renders-search {
    flex: 1;
    min-width: 120px;
    background: #181818;
    border: 1px solid #333;
    color: #eee;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 3px;
  }
  .renders-search:focus {
    outline: none;
    border-color: rgba(var(--accent-rgb), 0.5);
  }
  .renders-pin {
    background: rgba(var(--accent-rgb), 0.15);
    border: 1px solid rgba(var(--accent-rgb), 0.4);
    color: var(--accent);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    cursor: pointer;
  }
  .renders-empty {
    padding: 24px;
    text-align: center;
    color: #666;
    font-size: 12px;
  }
  .renders-timeline {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    padding: 6px 8px;
    height: 52px;
    overflow-x: auto;
    border-bottom: 1px solid #222;
    background: #0c0c0c;
  }
  .renders-bar {
    width: 6px;
    min-width: 6px;
    cursor: pointer;
    opacity: 0.75;
    transition: opacity 100ms;
    border-radius: 1px 1px 0 0;
  }
  .renders-bar:hover { opacity: 1; }
  .renders-bar.is-selected { outline: 1px solid #fff; opacity: 1; }
  .renders-bar.cause-mount    { background: #4ade80; }
  .renders-bar.cause-state    { background: #a855f7; }
  .renders-bar.cause-context  { background: #fb923c; }
  .renders-bar.cause-props    { background: #60a5fa; }
  .renders-bar.cause-parent   { background: #6b7280; }
  .renders-bar.cause-bailout  { background: #374151; }
  .renders-detail {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .renders-detail-header {
    display: flex;
    align-items: center;
    font-weight: 600;
    font-size: 12px;
    color: #eee;
    padding-bottom: 6px;
    border-bottom: 1px solid #222;
    margin-bottom: 6px;
  }
  .renders-detail-time {
    margin-left: auto;
    color: #666;
    font-weight: 400;
    font-size: 10px;
  }
  .renders-entry-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .renders-entry {
    padding: 4px 0;
    border-bottom: 1px solid #1a1a1a;
  }
  .renders-entry-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11px;
  }
  .renders-pip {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .renders-pip.cause-mount    { background: #4ade80; }
  .renders-pip.cause-state    { background: #a855f7; }
  .renders-pip.cause-context  { background: #fb923c; }
  .renders-pip.cause-props    { background: #60a5fa; }
  .renders-pip.cause-parent   { background: #6b7280; }
  .renders-pip.cause-bailout  { background: #374151; }
  .renders-entry-name {
    background: none;
    border: none;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    padding: 0;
  }
  .renders-entry-name:hover { text-decoration: underline; }
  .renders-entry-cause {
    color: #888;
    font-size: 10px;
    text-transform: capitalize;
  }
  .renders-entry-keys {
    color: #ccc;
    font-family: monospace;
    font-size: 10px;
    background: #181818;
    padding: 1px 5px;
    border-radius: 2px;
  }
  .renders-entry-pin,
  .renders-entry-expand {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 2px 4px;
    font-size: 10px;
  }
  .renders-entry-pin:hover,
  .renders-entry-expand:hover { color: #ddd; }
  .renders-entry-pin { margin-left: auto; }
  .renders-entry-diff {
    padding: 4px 18px 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .renders-entry-diff-row {
    display: flex;
    gap: 6px;
    align-items: center;
    font-family: monospace;
    font-size: 10px;
  }
  .renders-entry-diff-key {
    color: #aaa;
    min-width: 80px;
  }
  .renders-entry-diff-prev {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.08);
    padding: 0 4px;
    border-radius: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }
  .renders-entry-diff-arrow { color: #555; }
  .renders-entry-diff-next {
    color: #86efac;
    background: rgba(34, 197, 94, 0.08);
    padding: 0 4px;
    border-radius: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }

  .settings-number-input {
    background: #181818;
    border: 1px solid #333;
    color: #eee;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 3px;
    width: 80px;
  }
  .settings-number-input:focus {
    outline: none;
    border-color: rgba(var(--accent-rgb), 0.5);
  }
`
