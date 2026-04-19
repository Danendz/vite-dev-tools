import { h } from 'preact'
import { useRef, useState, useCallback, useMemo } from 'preact/hooks'
import type { NormalizedNode, DockPosition, ActiveTab, ConsoleEntry, CommitRecord } from '../types'
import { TreeView } from './TreeView'
import { DetailPanel } from './DetailPanel'
import { ConsolePane } from './ConsolePane'
import { RendersPane } from './RendersPane'
import { SettingsModal } from './SettingsModal'
import { Tooltip } from './Tooltip'
import { STORAGE_KEYS } from '../../shared/constants'

const MIN_HEIGHT = 150
const MAX_HEIGHT_RATIO = 0.8
const MIN_WIDTH = 250
const MAX_WIDTH_RATIO = 0.6

interface PanelProps {
  tree: NormalizedNode[]
  selectedNode: NormalizedNode | null
  dockPosition: DockPosition
  panelSize: number
  activeTab: ActiveTab
  searchQuery: string
  matchingNodeIds: Set<string> | null
  searchAncestorIds: Set<string> | null
  consoleEntries: ConsoleEntry[]
  consoleFilters: { errors: boolean; warnings: boolean; logs: boolean }
  errorCount: number
  isPickerActive: boolean
  expandedNodeIds: Set<string> | null
  elementExpandedNodeIds: Set<string> | null
  showElements: boolean
  settingsOpen: boolean
  hideLibrary: boolean
  hideProviders: boolean
  showPreview: boolean
  editor: string
  fontSize: number
  supportedSettings?: string[]
  onSearchChange: (query: string) => void
  onPickerToggle: () => void
  onSettingsToggle: () => void
  onHideLibraryToggle: () => void
  onHideProvidersToggle: () => void
  onShowElementsToggle: () => void
  onShowPreviewToggle: () => void
  onEditorChange: (editor: string) => void
  onFontSizeChange: (size: number) => void
  onDockChange: (pos: DockPosition) => void
  onResize: (size: number) => void
  onTabChange: (tab: ActiveTab) => void
  onFilterChange: (filters: { errors: boolean; warnings: boolean; logs: boolean }) => void
  onClearConsole: () => void
  consoleStripLibrary: boolean
  onConsoleStripLibraryToggle: () => void
  clearConsoleOnReload: boolean
  onClearConsoleOnReloadToggle: () => void
  editedProps: Map<string, Set<string>>
  expandedPropsSet: Set<string>
  onPropEdit: (nodeId: string, propKey: string) => void
  onPropPersisted: (nodeId: string, propKey: string) => void
  onExpandProps: (nodeId: string) => void
  mcpEnabled: boolean
  mcpPaused: boolean
  aiHighlightActive: boolean
  aiSelectedNodeIds?: Set<string>
  showAiActions: boolean
  onClearAiHighlight: () => void
  onMcpPausedToggle: () => void
  onShowAiActionsToggle: () => void
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
  onClose: () => void
  // Error attribution
  errorCountMap: Map<string, number>
  directErrorMap: Map<string, number>
  nodeHasError: Set<string>
  errorFilterActive: boolean
  errorAncestorIds: Set<string> | null
  onErrorFilterToggle: () => void
  // Render-cause attribution
  renderCauseEnabled: boolean
  renderHistorySize: number
  renderIncludeValues: boolean
  renderHistory: CommitRecord[]
  renderHistoryRecording: boolean
  pinnedRenderComponentId: number | null
  commitComponentIds: Set<number> | null
  onRenderCauseToggle: () => void
  onRenderHistorySizeChange: (size: number) => void
  onRenderIncludeValuesToggle: () => void
  onRenderHistoryRecordingToggle: () => void
  onClearRenderHistory: () => void
  onPinRenderComponent: (persistentId: number | null) => void
  onNavigateToCommit?: (commitIndex: number) => void
  focusCommitIndex?: number | null
  onFocusCommitConsumed?: () => void
  mode?: 'docked' | 'popup'
  onDetach?: () => void
  onDockBack?: () => void
}

export function Panel({
  tree,
  selectedNode,
  dockPosition,
  panelSize,
  activeTab,
  searchQuery,
  matchingNodeIds,
  searchAncestorIds,
  consoleEntries,
  consoleFilters,
  errorCount,
  isPickerActive,
  expandedNodeIds,
  elementExpandedNodeIds,
  showElements,
  settingsOpen,
  hideLibrary,
  hideProviders,
  showPreview,
  editor,
  fontSize,
  supportedSettings,
  onSearchChange,
  onPickerToggle,
  onSettingsToggle,
  onHideLibraryToggle,
  onHideProvidersToggle,
  onShowElementsToggle,
  onShowPreviewToggle,
  onEditorChange,
  onFontSizeChange,
  onDockChange,
  onResize,
  onTabChange,
  onFilterChange,
  onClearConsole,
  consoleStripLibrary,
  onConsoleStripLibraryToggle,
  clearConsoleOnReload,
  onClearConsoleOnReloadToggle,
  editedProps,
  expandedPropsSet,
  mcpEnabled,
  mcpPaused,
  aiHighlightActive,
  aiSelectedNodeIds,
  showAiActions,
  onClearAiHighlight,
  onMcpPausedToggle,
  onShowAiActionsToggle,
  onPropEdit,
  onPropPersisted,
  onExpandProps,
  onSelect,
  onHover,
  onContextMenu,
  onClose,
  errorCountMap,
  directErrorMap,
  nodeHasError,
  errorFilterActive,
  errorAncestorIds,
  onErrorFilterToggle,
  renderCauseEnabled,
  renderHistorySize,
  renderIncludeValues,
  renderHistory,
  renderHistoryRecording,
  pinnedRenderComponentId,
  commitComponentIds,
  onRenderCauseToggle,
  onRenderHistorySizeChange,
  onRenderIncludeValuesToggle,
  onRenderHistoryRecordingToggle,
  onClearRenderHistory,
  onPinRenderComponent,
  onNavigateToCommit,
  focusCommitIndex,
  onFocusCommitConsumed,
  mode = 'docked',
  onDetach,
  onDockBack,
}: PanelProps) {
  const [detailSize, setDetailSize] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.DETAIL_SIZE)
    if (stored) {
      const num = parseInt(stored, 10)
      if (!isNaN(num) && num > 0) return num
    }
    return dockPosition === 'bottom' ? 260 : 220
  })
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null)
  const detailDragRef = useRef<{ startPos: number; startSize: number } | null>(null)

  const handleDetailPointerDown = useCallback(
    (e: PointerEvent) => {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      const startPos = dockPosition === 'bottom' ? e.clientX : e.clientY
      detailDragRef.current = { startPos, startSize: detailSize }
      document.documentElement.style.userSelect = 'none'
    },
    [dockPosition, detailSize],
  )

  const handleDetailPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!detailDragRef.current) return
      const { startPos, startSize } = detailDragRef.current
      if (dockPosition === 'bottom') {
        // Horizontal: dragging left edge of detail pane
        const delta = startPos - e.clientX
        setDetailSize(Math.max(120, Math.min(startSize + delta, panelSize * 0.85)))
      } else {
        // Vertical: dragging top edge of detail pane
        const delta = startPos - e.clientY
        setDetailSize(Math.max(60, Math.min(startSize + delta, panelSize * 0.85)))
      }
    },
    [dockPosition, panelSize],
  )

  const handleDetailPointerUp = useCallback(() => {
    if (detailDragRef.current) {
      localStorage.setItem(STORAGE_KEYS.DETAIL_SIZE, String(detailSize))
    }
    detailDragRef.current = null
    document.documentElement.style.userSelect = ''
  }, [detailSize])

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      const startPos = dockPosition === 'bottom' ? e.clientY : e.clientX
      dragRef.current = { startPos, startSize: panelSize }
      document.documentElement.style.userSelect = 'none'
    },
    [dockPosition, panelSize],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return
      const { startPos, startSize } = dragRef.current

      let newSize: number
      if (dockPosition === 'bottom') {
        const delta = startPos - e.clientY
        newSize = Math.max(MIN_HEIGHT, Math.min(startSize + delta, window.innerHeight * MAX_HEIGHT_RATIO))
      } else if (dockPosition === 'right') {
        const delta = startPos - e.clientX
        newSize = Math.max(MIN_WIDTH, Math.min(startSize + delta, window.innerWidth * MAX_WIDTH_RATIO))
      } else {
        const delta = e.clientX - startPos
        newSize = Math.max(MIN_WIDTH, Math.min(startSize + delta, window.innerWidth * MAX_WIDTH_RATIO))
      }

      onResize(newSize)
    },
    [dockPosition, onResize],
  )

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
    document.documentElement.style.userSelect = ''
  }, [])

  const wrapperStyle = useMemo(() => {
    if (mode === 'popup') {
      return { position: 'relative' as const, width: '100%', height: '100vh' }
    }
    const base = { position: 'fixed' as const, zIndex: 2147483646 }
    if (dockPosition === 'bottom') {
      return { ...base, bottom: '0', left: '0', right: '0', height: `${panelSize}px` }
    }
    if (dockPosition === 'left') {
      return { ...base, top: '0', left: '0', bottom: '0', width: `${panelSize}px` }
    }
    return { ...base, top: '0', right: '0', bottom: '0', width: `${panelSize}px` }
  }, [mode, dockPosition, panelSize])

  const attributedErrors = useMemo(() => {
    if (!selectedNode) return []
    return consoleEntries.filter(e => e.ownedBy?.nodeId === selectedNode.id && e.type !== 'log')
  }, [consoleEntries, selectedNode])

  const isVertical = dockPosition !== 'bottom'

  return (
    <div class="panel-wrapper" style={wrapperStyle}>
      {mode === 'docked' && (
        <div
          class={`resize-handle resize-handle-${dockPosition}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">vite-devtools</span>
          <div class="panel-header-controls">
            {/* Element picker — both modes */}
            <Tooltip text="Select element">
              <button
                class={`dock-btn${isPickerActive ? ' active' : ''}`}
                onClick={onPickerToggle}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="6.5" cy="6.5" r="4" />
                  <line x1="10" y1="10" x2="14" y2="14" />
                </svg>
              </button>
            </Tooltip>
            {/* Clear AI highlight — both modes */}
            {aiHighlightActive && (
              <Tooltip text="Clear AI highlight">
                <button
                  class="ai-highlight-clear-btn"
                  onClick={onClearAiHighlight}
                >
                  AI {'\u00d7'}
                </button>
              </Tooltip>
            )}
            {/* Settings — both modes */}
            <Tooltip text="Settings">
              <button
                class={`dock-btn${settingsOpen ? ' active' : ''}`}
                onClick={onSettingsToggle}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="8" cy="8" r="2" />
                  <path d="M13.5 8a5.5 5.5 0 0 1-.15 1.2l1.4 1.1a.3.3 0 0 1 .07.4l-1.3 2.3a.3.3 0 0 1-.38.13l-1.65-.67a5.2 5.2 0 0 1-1.04.6l-.25 1.75a.3.3 0 0 1-.3.25H7.6a.3.3 0 0 1-.3-.25l-.25-1.75a5 5 0 0 1-1.04-.6l-1.65.67a.3.3 0 0 1-.38-.13l-1.3-2.3a.3.3 0 0 1 .07-.4l1.4-1.1A5.4 5.4 0 0 1 4 8c0-.4.05-.8.15-1.2l-1.4-1.1a.3.3 0 0 1-.07-.4l1.3-2.3a.3.3 0 0 1 .38-.13l1.65.67a5.2 5.2 0 0 1 1.04-.6L7.3 1.2a.3.3 0 0 1 .3-.25h2.6a.3.3 0 0 1 .3.25l.25 1.75a5 5 0 0 1 1.04.6l1.65-.67a.3.3 0 0 1 .38.13l1.3 2.3a.3.3 0 0 1-.07.4l-1.4 1.1c.1.4.15.8.15 1.2z" transform="scale(0.85) translate(1.4, 1.4)" />
                </svg>
              </button>
            </Tooltip>
            {/* Docked-mode controls */}
            {mode === 'docked' && (
              <>
                {/* Dock left */}
                <Tooltip text="Dock left">
                  <button
                    class={`dock-btn${dockPosition === 'left' ? ' active' : ''}`}
                    onClick={() => onDockChange('left')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <line x1="7" y1="2" x2="7" y2="14" />
                    </svg>
                  </button>
                </Tooltip>
                {/* Dock bottom */}
                <Tooltip text="Dock bottom">
                  <button
                    class={`dock-btn${dockPosition === 'bottom' ? ' active' : ''}`}
                    onClick={() => onDockChange('bottom')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <line x1="2" y1="10" x2="14" y2="10" />
                    </svg>
                  </button>
                </Tooltip>
                {/* Dock right */}
                <Tooltip text="Dock right">
                  <button
                    class={`dock-btn${dockPosition === 'right' ? ' active' : ''}`}
                    onClick={() => onDockChange('right')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <line x1="9" y1="2" x2="9" y2="14" />
                    </svg>
                  </button>
                </Tooltip>
                {/* Open in popup window */}
                {onDetach && (
                  <Tooltip text="Open in popup window">
                    <button class="dock-btn" onClick={onDetach}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="1" y="4" width="10" height="10" rx="1" />
                        <path d="M9 1h6v6" />
                        <path d="M15 1L8 8" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
                <Tooltip text="Close" shortcut="Ctrl+Shift+D">
                  <button class="panel-close" onClick={onClose}>
                    ×
                  </button>
                </Tooltip>
              </>
            )}
            {/* Popup-mode controls */}
            {mode === 'popup' && (
              <Tooltip text="Dock back to page">
                <button class="dock-btn" onClick={onDockBack}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="2" width="12" height="12" rx="1" />
                    <path d="M6 6l-4 4" />
                    <path d="M2 7v3h3" />
                  </svg>
                </button>
              </Tooltip>
            )}
          </div>
          {settingsOpen && (
            <SettingsModal
              hideLibrary={hideLibrary}
              hideProviders={hideProviders}
              showElements={showElements}
              showPreview={showPreview}
              editor={editor}
              fontSize={fontSize}
              mcpEnabled={mcpEnabled}
              mcpPaused={mcpPaused}
              showAiActions={showAiActions}
              supportedSettings={supportedSettings}
              onHideLibraryToggle={onHideLibraryToggle}
              onHideProvidersToggle={onHideProvidersToggle}
              onShowElementsToggle={onShowElementsToggle}
              onShowPreviewToggle={onShowPreviewToggle}
              onEditorChange={onEditorChange}
              onFontSizeChange={onFontSizeChange}
              onMcpPausedToggle={onMcpPausedToggle}
              onShowAiActionsToggle={onShowAiActionsToggle}
              renderCauseEnabled={renderCauseEnabled}
              renderHistorySize={renderHistorySize}
              renderIncludeValues={renderIncludeValues}
              onRenderCauseToggle={onRenderCauseToggle}
              onRenderHistorySizeChange={onRenderHistorySizeChange}
              onRenderIncludeValuesToggle={onRenderIncludeValuesToggle}
              consoleStripLibrary={consoleStripLibrary}
              onConsoleStripLibraryToggle={onConsoleStripLibraryToggle}
              clearConsoleOnReload={clearConsoleOnReload}
              onClearConsoleOnReloadToggle={onClearConsoleOnReloadToggle}
              onClose={onSettingsToggle}
            />
          )}
        </div>
        <div class="tab-bar">
          <button
            class={`tab-btn${activeTab === 'inspect' ? ' tab-active' : ''}`}
            onClick={() => onTabChange('inspect')}
          >
            Inspect
          </button>
          <button
            class={`tab-btn${activeTab === 'console' ? ' tab-active' : ''}`}
            onClick={() => onTabChange('console')}
          >
            Console
            {activeTab !== 'console' && errorCount > 0 && (
              <span class="tab-badge">{errorCount}</span>
            )}
          </button>
          {renderCauseEnabled && (
            <button
              class={`tab-btn${activeTab === 'renders' ? ' tab-active' : ''}`}
              onClick={() => onTabChange('renders')}
            >
              Renders
            </button>
          )}
        </div>
        {activeTab === 'inspect' ? (
          <div class={`panel-body${isVertical ? ' panel-body-vertical' : ''}`} style={{ fontSize: `${fontSize}px` }}>
            <div class="tree-pane">
              <TreeView
                tree={tree}
                selectedId={selectedNode?.id ?? null}
                expandedNodeIds={expandedNodeIds}
                elementExpandedNodeIds={elementExpandedNodeIds}
                showAllElements={showElements}
                searchQuery={searchQuery}
                matchingNodeIds={matchingNodeIds}
                searchAncestorIds={searchAncestorIds}
                editedProps={editedProps}
                expandedPropsSet={expandedPropsSet}
                aiSelectedNodeIds={aiSelectedNodeIds}
                showAiActions={showAiActions}
                commitComponentIds={commitComponentIds}
                errorCountMap={errorCountMap}
                directErrorMap={directErrorMap}
                nodeHasError={nodeHasError}
                errorFilterActive={errorFilterActive}
                errorAncestorIds={errorAncestorIds}
                onErrorFilterToggle={onErrorFilterToggle}
                onSearchChange={onSearchChange}
                onPropEdit={onPropEdit}
                onExpandProps={onExpandProps}
                onSelect={onSelect}
                onHover={onHover}
                onContextMenu={onContextMenu}
              />
            </div>
            <div
              class="detail-pane"
              style={isVertical ? { height: `${detailSize}px` } : { width: `${detailSize}px` }}
            >
              <div
                class="detail-resize-handle"
                style={isVertical
                  ? { top: 0, left: 0, right: 0, height: '4px', cursor: 'ns-resize' }
                  : { top: 0, left: 0, bottom: 0, width: '4px', cursor: 'ew-resize' }
                }
                onPointerDown={handleDetailPointerDown}
                onPointerMove={handleDetailPointerMove}
                onPointerUp={handleDetailPointerUp}
              />
              <DetailPanel node={selectedNode} editedProps={editedProps} onPropEdit={onPropEdit} onPropPersisted={onPropPersisted} renderHistory={renderHistory} onNavigateToCommit={onNavigateToCommit} attributedErrors={attributedErrors} tree={tree} />
            </div>
          </div>
        ) : activeTab === 'console' ? (
          <ConsolePane
            entries={consoleEntries}
            filters={consoleFilters}
            onFilterChange={onFilterChange}
            onClear={onClearConsole}
            stripLibrary={consoleStripLibrary}
            tree={tree}
            renderHistory={renderHistory}
          />
        ) : (
          <RendersPane
            tree={tree}
            history={renderHistory}
            recording={renderHistoryRecording}
            pinnedPersistentId={pinnedRenderComponentId}
            focusCommitIndex={focusCommitIndex}
            onToggleRecording={onRenderHistoryRecordingToggle}
            onClear={onClearRenderHistory}
            onJumpToComponent={(node) => {
              onSelect(node)
              onTabChange('inspect')
            }}
            onPin={onPinRenderComponent}
            onFocusCommitConsumed={onFocusCommitConsumed}
          />
        )}
      </div>
    </div>
  )
}
