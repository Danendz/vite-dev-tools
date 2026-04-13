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
} as const

// localStorage keys
export const STORAGE_KEYS = {
  COLLAPSE_OVERRIDES: 'danendz-devtools:collapse-overrides',
  PANEL_OPEN: 'danendz-devtools:panel-open',
  DOCK_POSITION: 'danendz-devtools:dock-position',
  PANEL_SIZE: 'danendz-devtools:panel-size',
  HIDE_LIBRARY: 'danendz-devtools:hide-library',
  HIDE_PROVIDERS: 'danendz-devtools:hide-providers',
  FONT_SIZE: 'danendz-devtools:font-size',
  EDITOR: 'danendz-devtools:editor',
} as const

// Server endpoints
export const ENDPOINTS = {
  OPEN_EDITOR: '/__devtools/open-editor',
} as const

// Default config
export const DEFAULT_CONFIG = {
  open: false,
  shortcut: 'ctrl+shift+d',
} as const
