// Virtual module IDs
export const VIRTUAL_CLIENT_ID = 'virtual:@danendz/devtools-client'
export const VIRTUAL_REACT_RUNTIME_ID = 'virtual:@danendz/devtools-react-runtime'
export const RESOLVED_CLIENT_ID = '\0' + VIRTUAL_CLIENT_ID
export const RESOLVED_REACT_RUNTIME_ID = '\0' + VIRTUAL_REACT_RUNTIME_ID

// HMR/WebSocket event names
export const EVENTS = {
  TREE_UPDATE: 'devtools:tree-update',
  OPEN_EDITOR: 'devtools:open-editor',
  REWALK: 'devtools:rewalk',
  HOOK_EDIT: 'devtools:hook-edit',
  PROP_EDIT: 'devtools:prop-edit',
  PROP_PERSISTED: 'devtools:prop-persisted',
  TEXT_EDIT: 'devtools:text-edit',
  VALUE_EDIT: 'devtools:value-edit',
  TOAST: 'devtools:toast',
} as const

// localStorage keys
export const STORAGE_KEYS = {
  PANEL_OPEN: 'danendz-devtools:panel-open',
  DOCK_POSITION: 'danendz-devtools:dock-position',
  PANEL_SIZE: 'danendz-devtools:panel-size',
  HIDE_LIBRARY: 'danendz-devtools:hide-library',
  HIDE_PROVIDERS: 'danendz-devtools:hide-providers',
  FONT_SIZE: 'danendz-devtools:font-size',
  EDITOR: 'danendz-devtools:editor',
  DETAIL_SIZE: 'danendz-devtools:detail-size',
  SHOW_ELEMENTS: 'danendz-devtools:show-elements',
  SHOW_PREVIEW: 'danendz-devtools:show-preview',
  SHOW_AI_ACTIONS: 'danendz-devtools:show-ai-actions',
  MCP_PAUSED: 'danendz-devtools:mcp-paused',
} as const

// Server endpoints
export const ENDPOINTS = {
  OPEN_EDITOR: '/__devtools/open-editor',
  PERSIST_EDIT: '/__devtools/persist-edit',
  PERSIST_HOOK: '/__devtools/persist-hook',
  PERSIST_PROP: '/__devtools/persist-prop',
  PERSIST_TEXT: '/__devtools/persist-text',
  UNDO_EDIT: '/__devtools/undo-edit',
  MCP: '/__devtools/mcp',
} as const

// MCP bridge events (over Vite HMR WebSocket)
export const BRIDGE_EVENTS = {
  REQUEST: 'devtools:bridge-request',
  RESPONSE: 'devtools:bridge-response',
  TAB_REGISTER: 'devtools:tab-register',
  TAB_FOCUS: 'devtools:tab-focus',
  TAB_UNLOAD: 'devtools:tab-unload',
} as const

// Default config
export const DEFAULT_CONFIG = {
  open: false,
  shortcut: 'ctrl+shift+d',
  mcp: true,
} as const
