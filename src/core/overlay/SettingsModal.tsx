import { h } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { STORAGE_KEYS } from '../../shared/constants'
import { Tooltip } from './Tooltip'

type SettingsCategory = 'general' | 'console' | 'appearance' | 'mcp'

const FONT_SIZES = [9, 10, 11, 12, 13, 14]

const EDITOR_OPTIONS = [
  { label: 'Auto-detect', value: '' },
  { label: 'VS Code', value: 'code' },
  { label: 'Cursor', value: 'cursor' },
  { label: 'PhpStorm', value: 'phpstorm' },
  { label: 'WebStorm', value: 'webstorm' },
  { label: 'IntelliJ IDEA', value: 'idea' },
  { label: 'Sublime Text', value: 'subl' },
  { label: 'Zed', value: 'zed' },
  { label: 'Antigravity', value: 'antigravity' },
]

type McpCommandTab = 'claude' | 'vscode' | 'codex' | 'custom'

function getMcpUrl(): string {
  return `${window.location.origin}/__devtools/mcp`
}

function getMcpCommand(tab: McpCommandTab): string {
  const url = getMcpUrl()
  switch (tab) {
    case 'claude':
      return `claude mcp add vite-devtools --transport http ${url}`
    case 'vscode':
      return JSON.stringify({
        servers: {
          'vite-devtools': {
            type: 'http',
            url,
          },
        },
      }, null, 2)
    case 'codex':
      return `codex mcp add vite-devtools --transport http --url ${url}`
    case 'custom':
      return url
  }
}

interface SettingsModalProps {
  hideLibrary: boolean
  hideProviders: boolean
  showElements: boolean
  showPreview: boolean
  editor: string
  fontSize: number
  mcpEnabled: boolean
  mcpPaused: boolean
  showAiActions: boolean
  supportedSettings?: string[]
  onHideLibraryToggle: () => void
  onHideProvidersToggle: () => void
  onShowElementsToggle: () => void
  onShowPreviewToggle: () => void
  onEditorChange: (editor: string) => void
  onFontSizeChange: (size: number) => void
  onMcpPausedToggle: () => void
  onShowAiActionsToggle: () => void
  renderCauseEnabled: boolean
  renderHistorySize: number
  renderIncludeValues: boolean
  onRenderCauseToggle: () => void
  onRenderHistorySizeChange: (size: number) => void
  onRenderIncludeValuesToggle: () => void
  consoleStripLibrary: boolean
  onConsoleStripLibraryToggle: () => void
  clearConsoleOnReload: boolean
  onClearConsoleOnReloadToggle: () => void
  onClose: () => void
}

function Toggle({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      class={`settings-toggle${checked ? ' active' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      role="switch"
      aria-checked={checked}
    >
      <span class="settings-toggle-thumb" />
    </button>
  )
}

export function SettingsModal({
  hideLibrary,
  hideProviders,
  showElements,
  showPreview,
  editor,
  fontSize,
  mcpEnabled,
  mcpPaused,
  showAiActions,
  supportedSettings,
  onHideLibraryToggle,
  onHideProvidersToggle,
  onShowElementsToggle,
  onShowPreviewToggle,
  onEditorChange,
  onFontSizeChange,
  onMcpPausedToggle,
  onShowAiActionsToggle,
  renderCauseEnabled,
  renderHistorySize,
  renderIncludeValues,
  onRenderCauseToggle,
  onRenderHistorySizeChange,
  onRenderIncludeValuesToggle,
  consoleStripLibrary,
  onConsoleStripLibraryToggle,
  clearConsoleOnReload,
  onClearConsoleOnReloadToggle,
  onClose,
}: SettingsModalProps) {
  const [category, setCategory] = useState<SettingsCategory>('general')
  const [mcpCommandTab, setMcpCommandTab] = useState<McpCommandTab>('claude')
  const [copied, setCopied] = useState(false)
  const showHideProviders = !supportedSettings || supportedSettings.includes('hideProviders')

  const isKnown = EDITOR_OPTIONS.some((o) => o.value === editor)
  const [customMode, setCustomMode] = useState(!isKnown)
  const [customValue, setCustomValue] = useState(isKnown ? '' : editor)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const handleCopy = useCallback(() => {
    const text = getMcpCommand(mcpCommandTab)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [mcpCommandTab])

  const categories: { id: SettingsCategory; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'console', label: 'Console' },
    { id: 'appearance', label: 'Appearance' },
    ...(mcpEnabled ? [{ id: 'mcp' as const, label: 'MCP' }] : []),
  ]

  return (
    <div class="settings-modal-backdrop" onClick={onClose}>
      <div class="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div class="settings-modal-sidebar">
          <div class="settings-modal-title">Settings</div>
          {categories.map(({ id, label }) => (
            <button
              key={id}
              class={`settings-nav-item${category === id ? ' active' : ''}`}
              onClick={() => setCategory(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="settings-modal-content">
          <div class="settings-modal-header">
            <span class="settings-modal-category-title">{categories.find(c => c.id === category)?.label}</span>
            <Tooltip text="Close" shortcut="Esc"><button class="settings-modal-close" onClick={onClose}>{'\u2715'}</button></Tooltip>
          </div>
          <div class="settings-modal-body">
            {category === 'general' && (
              <div>
                <div class="settings-row" onClick={onHideLibraryToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Hide library components</div>
                    <div class="settings-row-desc">Hide components from node_modules in the tree</div>
                  </div>
                  <Toggle checked={hideLibrary} onClick={onHideLibraryToggle} />
                </div>
                {showHideProviders && (
                  <div class="settings-row" onClick={onHideProvidersToggle}>
                    <div class="settings-row-info">
                      <div class="settings-row-label">Hide providers</div>
                      <div class="settings-row-desc">Hide Provider wrapper components</div>
                    </div>
                    <Toggle checked={hideProviders} onClick={onHideProvidersToggle} />
                  </div>
                )}
                <div class="settings-row" onClick={onShowElementsToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Show HTML elements</div>
                    <div class="settings-row-desc">Show div, span, and other DOM elements in the tree</div>
                  </div>
                  <Toggle checked={showElements} onClick={onShowElementsToggle} />
                </div>
                <div class="settings-row" onClick={onShowPreviewToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Preview before saving</div>
                    <div class="settings-row-desc">Show a diff preview before persisting edits to source</div>
                  </div>
                  <Toggle checked={showPreview} onClick={onShowPreviewToggle} />
                </div>
                <div class="settings-row" onClick={onRenderCauseToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Render-cause attribution</div>
                    <div class="settings-row-desc">
                      Label why each component re-renders — props, state, context, or parent cascade.
                      Adds a "Renders" tab with commit history. Opt-in for performance.
                    </div>
                  </div>
                  <Toggle checked={renderCauseEnabled} onClick={onRenderCauseToggle} />
                </div>
                {renderCauseEnabled && (
                  <>
                    <div class="settings-row settings-row-no-click">
                      <div class="settings-row-info">
                        <div class="settings-row-label">History buffer size</div>
                        <div class="settings-row-desc">Maximum number of commits to keep (10–2000)</div>
                      </div>
                      <input
                        class="settings-number-input"
                        type="number"
                        min="10"
                        max="2000"
                        step="10"
                        value={renderHistorySize}
                        onChange={(e) => {
                          const val = parseInt((e.target as HTMLInputElement).value, 10)
                          if (!isNaN(val)) onRenderHistorySizeChange(val)
                        }}
                      />
                    </div>
                    <div class="settings-row" onClick={onRenderIncludeValuesToggle}>
                      <div class="settings-row-info">
                        <div class="settings-row-label">Include value previews</div>
                        <div class="settings-row-desc">Capture old → new value snapshots. Uses more memory.</div>
                      </div>
                      <Toggle checked={renderIncludeValues} onClick={onRenderIncludeValuesToggle} />
                    </div>
                  </>
                )}
                <div class="settings-row settings-row-no-click">
                  <div class="settings-row-info">
                    <div class="settings-row-label">Editor</div>
                    <div class="settings-row-desc">
                      Editor for "open in editor" actions.{' '}
                      <a href="https://github.com/yyx990803/launch-editor#supported-editors" target="_blank" rel="noopener">
                        Supported editors {'\u2192'}
                      </a>
                    </div>
                  </div>
                  <select
                    class="settings-select"
                    value={customMode ? '__custom__' : editor}
                    onChange={(e) => {
                      const val = (e.target as HTMLSelectElement).value
                      if (val === '__custom__') {
                        setCustomMode(true)
                        onEditorChange(customValue)
                      } else {
                        setCustomMode(false)
                        setCustomValue('')
                        onEditorChange(val)
                      }
                    }}
                  >
                    {EDITOR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    <option value="__custom__">Custom...</option>
                  </select>
                </div>
                {customMode && (
                  <div class="settings-row settings-row-no-click">
                    <div class="settings-row-info">
                      <div class="settings-row-label">Custom editor command</div>
                    </div>
                    <input
                      class="settings-custom-input"
                      type="text"
                      placeholder="Editor command..."
                      value={customValue}
                      onInput={(e) => {
                        const val = (e.target as HTMLInputElement).value
                        setCustomValue(val)
                        onEditorChange(val)
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {category === 'console' && (
              <div>
                <div class="settings-row" onClick={onConsoleStripLibraryToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Hide library internals</div>
                    <div class="settings-row-desc">Strip node_modules and Vite dependency lines from stack traces</div>
                  </div>
                  <Toggle checked={consoleStripLibrary} onClick={onConsoleStripLibraryToggle} />
                </div>
                <div class="settings-row" onClick={onClearConsoleOnReloadToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Clear on hot reload</div>
                    <div class="settings-row-desc">Automatically clear errors and warnings when files change</div>
                  </div>
                  <Toggle checked={clearConsoleOnReload} onClick={onClearConsoleOnReloadToggle} />
                </div>
              </div>
            )}

            {category === 'appearance' && (
              <div>
                <div class="settings-row settings-row-no-click">
                  <div class="settings-row-info">
                    <div class="settings-row-label">Font size</div>
                    <div class="settings-row-desc">Adjust the tree and detail panel font size</div>
                  </div>
                  <div class="settings-font-btns">
                    {FONT_SIZES.map((size) => (
                      <button
                        key={size}
                        class={`settings-font-btn${fontSize === size ? ' active' : ''}`}
                        onClick={() => onFontSizeChange(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {category === 'mcp' && mcpEnabled && (
              <div>
                <div class="settings-row settings-row-no-click">
                  <div class="settings-row-info">
                    <div class="settings-row-label">Status</div>
                    <div class="settings-row-desc">MCP server connection status</div>
                  </div>
                  <div class={`settings-status-badge${mcpPaused ? ' paused' : ' active'}`}>
                    <span class="settings-status-dot" />
                    {mcpPaused ? 'Paused' : 'Active'}
                  </div>
                </div>
                <div class="settings-row" onClick={onMcpPausedToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Enable MCP bridge</div>
                    <div class="settings-row-desc">Allow AI agents to query page state and drive the overlay</div>
                  </div>
                  <Toggle checked={!mcpPaused} onClick={onMcpPausedToggle} />
                </div>
                <div class="settings-row" onClick={onShowAiActionsToggle}>
                  <div class="settings-row-info">
                    <div class="settings-row-label">Show AI actions</div>
                    <div class="settings-row-desc">Visually distinguish AI-triggered highlights and selections</div>
                  </div>
                  <Toggle checked={showAiActions} onClick={onShowAiActionsToggle} />
                </div>
                <div class="settings-section-label">Connection</div>
                <div class="settings-command-tabs">
                  {(['claude', 'vscode', 'codex', 'custom'] as McpCommandTab[]).map((tab) => (
                    <button
                      key={tab}
                      class={`settings-command-tab${mcpCommandTab === tab ? ' active' : ''}`}
                      onClick={() => { setMcpCommandTab(tab); setCopied(false) }}
                    >
                      {tab === 'claude' ? 'Claude Code' : tab === 'vscode' ? 'VS Code' : tab === 'codex' ? 'Codex' : 'Custom'}
                    </button>
                  ))}
                </div>
                <div class="settings-command-block">
                  <pre class="settings-command-code">{getMcpCommand(mcpCommandTab)}</pre>
                  <Tooltip text="Copy command">
                    <button class="settings-command-copy" onClick={handleCopy}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
