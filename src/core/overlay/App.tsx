import { h } from 'preact'
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks'
import type { NormalizedNode, DevToolsConfig, TreeUpdateEvent, DockPosition, ActiveTab, ConsoleEntry } from '../types'
import { FloatingIcon } from './FloatingIcon'
import { Panel } from './Panel'
import { Highlight } from './Highlight'
import { ContextMenu } from './ContextMenu'
import { addAlwaysShow, addAlwaysHide, removeOverride } from '../collapse'
import { startCapture } from '../console-capture'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'

function findNodeById(nodes: NormalizedNode[], id: string): NormalizedNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children, id)
    if (found) return found
  }
  return null
}

function buildReverseMap(nodes: NormalizedNode[], map: Map<HTMLElement, NormalizedNode>) {
  for (const node of nodes) {
    if (node._domElements) {
      for (const el of node._domElements) {
        map.set(el, node)
      }
    }
    buildReverseMap(node.children, map)
  }
}

function findNodeForElement(el: HTMLElement | null, map: Map<HTMLElement, NormalizedNode>): NormalizedNode | null {
  while (el) {
    const node = map.get(el)
    if (node) return node
    el = el.parentElement
  }
  return null
}

function findNodePath(nodes: NormalizedNode[], targetId: string): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return [node.id]
    const childPath = findNodePath(node.children, targetId)
    if (childPath) return [node.id, ...childPath]
  }
  return null
}

interface AppProps {
  config: DevToolsConfig
}

export function App({ config }: AppProps) {
  const [isOpen, setIsOpen] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PANEL_OPEN)
    if (stored !== null) return stored === 'true'
    return config.open ?? false
  })
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.DOCK_POSITION)
    if (stored === 'left' || stored === 'right' || stored === 'bottom') return stored
    return 'bottom'
  })
  const [panelSize, setPanelSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PANEL_SIZE)
    if (stored) {
      const num = parseInt(stored, 10)
      if (!isNaN(num) && num > 0) return num
    }
    return 300
  })
  const [activeTab, setActiveTab] = useState<ActiveTab>('inspect')
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [consoleFilters, setConsoleFilters] = useState<{ errors: boolean; warnings: boolean }>({
    errors: true,
    warnings: true,
  })
  const [hideLibrary, setHideLibrary] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.HIDE_LIBRARY) !== 'false'
  })
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.FONT_SIZE)
    return stored ? parseInt(stored, 10) : 11
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isPickerActive, setIsPickerActive] = useState(false)
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string> | null>(null)
  const [tree, setTree] = useState<NormalizedNode[]>([])
  const [selectedNode, setSelectedNode] = useState<NormalizedNode | null>(null)
  const reverseMapRef = useRef(new Map<HTMLElement, NormalizedNode>())
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [highlightName, setHighlightName] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: NormalizedNode
  } | null>(null)

  // Listen for tree updates from the React runtime
  useEffect(() => {
    function handleTreeUpdate(e: Event) {
      const { tree: newTree } = (e as CustomEvent<TreeUpdateEvent>).detail
      setTree(newTree)
      // Rebuild reverse DOM → node map
      const map = new Map<HTMLElement, NormalizedNode>()
      buildReverseMap(newTree, map)
      reverseMapRef.current = map
      // Re-find the selected node in the new tree to get fresh props/hooks/state
      setSelectedNode((prev) => {
        if (!prev) return null
        return findNodeById(newTree, prev.id) ?? null
      })
    }
    window.addEventListener(EVENTS.TREE_UPDATE, handleTreeUpdate)
    return () => window.removeEventListener(EVENTS.TREE_UPDATE, handleTreeUpdate)
  }, [])

  // Keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const shortcut = config.shortcut ?? 'ctrl+shift+d'
      const parts = shortcut.toLowerCase().split('+')
      const needCtrl = parts.includes('ctrl')
      const needShift = parts.includes('shift')
      const needAlt = parts.includes('alt')
      const key = parts.find((p) => !['ctrl', 'shift', 'alt', 'meta'].includes(p))

      if (
        e.ctrlKey === needCtrl &&
        e.shiftKey === needShift &&
        e.altKey === needAlt &&
        e.key.toLowerCase() === key
      ) {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [config.shortcut])

  // Capture console errors/warnings
  useEffect(() => {
    return startCapture((entry) => {
      setConsoleEntries((prev) => {
        const next = [...prev, entry]
        return next.length > 500 ? next.slice(-500) : next
      })
    })
  }, [])

  const errorCount = useMemo(
    () => consoleEntries.filter((e) => e.type === 'error').length,
    [consoleEntries],
  )

  // Element picker mode
  useEffect(() => {
    if (!isPickerActive) return

    const devtoolsHost = document.getElementById('danendz-devtools')
    let lastNodeId: string | null = null

    function selectNode(node: NormalizedNode) {
      setSelectedNode(node)
      setActiveTab('inspect')
      const path = findNodePath(tree, node.id)
      if (path) setExpandedNodeIds(new Set(path))
    }

    function handlePickerMove(e: MouseEvent) {
      if (devtoolsHost?.contains(e.target as Node)) return
      const node = findNodeForElement(e.target as HTMLElement, reverseMapRef.current)
      if (node) {
        handleHover(node)
        // Select in tree on hover, but skip if same node
        if (node.id !== lastNodeId) {
          lastNodeId = node.id
          selectNode(node)
        }
      } else {
        handleHover(null)
        lastNodeId = null
      }
    }

    function handlePickerClick(e: MouseEvent) {
      if (devtoolsHost?.contains(e.target as Node)) return
      e.preventDefault()
      e.stopPropagation()
      const node = findNodeForElement(e.target as HTMLElement, reverseMapRef.current)
      if (node) {
        selectNode(node)
        handleHover(node)
      }
      setIsPickerActive(false)
    }

    function handlePickerKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsPickerActive(false)
        handleHover(null)
      }
    }

    document.addEventListener('mousemove', handlePickerMove, true)
    document.addEventListener('click', handlePickerClick, true)
    document.addEventListener('keydown', handlePickerKey, true)

    return () => {
      document.removeEventListener('mousemove', handlePickerMove, true)
      document.removeEventListener('click', handlePickerClick, true)
      document.removeEventListener('keydown', handlePickerKey, true)
      handleHover(null)
    }
  }, [isPickerActive, tree])

  const handlePickerToggle = useCallback(() => {
    setIsPickerActive((prev) => !prev)
    setExpandedNodeIds(null)
  }, [])

  const handleSettingsToggle = useCallback(() => {
    setSettingsOpen((prev) => !prev)
  }, [])

  const handleHideLibraryToggle = useCallback(() => {
    setHideLibrary((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.HIDE_LIBRARY, String(next))
      window.dispatchEvent(new CustomEvent(EVENTS.REWALK))
      return next
    })
  }, [])

  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size)
    localStorage.setItem(STORAGE_KEYS.FONT_SIZE, String(size))
  }, [])

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.PANEL_OPEN, String(next))
      return next
    })
  }, [])

  const handleDockChange = useCallback((pos: DockPosition) => {
    setDockPosition(pos)
    localStorage.setItem(STORAGE_KEYS.DOCK_POSITION, pos)
    const defaultSize = pos === 'bottom' ? 300 : 360
    setPanelSize(defaultSize)
    localStorage.setItem(STORAGE_KEYS.PANEL_SIZE, String(defaultSize))
  }, [])

  const handleResize = useCallback((newSize: number) => {
    setPanelSize(newSize)
    localStorage.setItem(STORAGE_KEYS.PANEL_SIZE, String(newSize))
  }, [])

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
  }, [])

  const handleClearConsole = useCallback(() => {
    setConsoleEntries([])
  }, [])

  const handleFilterChange = useCallback((filters: { errors: boolean; warnings: boolean }) => {
    setConsoleFilters(filters)
  }, [])

  const handleSelect = useCallback((node: NormalizedNode) => {
    setSelectedNode(node)
  }, [])

  const handleHover = useCallback((node: NormalizedNode | null) => {
    if (!node || !node._domElements || node._domElements.length === 0) {
      setHighlightRect(null)
      setHighlightName(null)
      return
    }
    // Compute union bounding rect across all DOM elements (handles fragments)
    let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity
    for (const el of node._domElements) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      top = Math.min(top, r.top)
      left = Math.min(left, r.left)
      bottom = Math.max(bottom, r.bottom)
      right = Math.max(right, r.right)
    }
    if (top === Infinity) {
      setHighlightRect(null)
      setHighlightName(null)
      return
    }
    setHighlightRect(new DOMRect(left, top, right - left, bottom - top))
    setHighlightName(node.name)
  }, [])

  const handleContextMenu = useCallback((e: MouseEvent, node: NormalizedNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  return (
    <div>
      <Highlight rect={highlightRect} name={highlightName} />

      {!isOpen && <FloatingIcon onClick={togglePanel} />}

      {isOpen && (
        <Panel
          tree={tree}
          selectedNode={selectedNode}
          dockPosition={dockPosition}
          panelSize={panelSize}
          activeTab={activeTab}
          consoleEntries={consoleEntries}
          consoleFilters={consoleFilters}
          errorCount={errorCount}
          isPickerActive={isPickerActive}
          expandedNodeIds={expandedNodeIds}
          settingsOpen={settingsOpen}
          hideLibrary={hideLibrary}
          fontSize={fontSize}
          onPickerToggle={handlePickerToggle}
          onSettingsToggle={handleSettingsToggle}
          onHideLibraryToggle={handleHideLibraryToggle}
          onFontSizeChange={handleFontSizeChange}
          onDockChange={handleDockChange}
          onResize={handleResize}
          onTabChange={handleTabChange}
          onFilterChange={handleFilterChange}
          onClearConsole={handleClearConsole}
          onSelect={handleSelect}
          onHover={handleHover}
          onContextMenu={handleContextMenu}
          onClose={togglePanel}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeName={contextMenu.node.name}
          isFromNodeModules={contextMenu.node.isFromNodeModules}
          onAlwaysShow={() => {
            addAlwaysShow(contextMenu.node.name)
            closeContextMenu()
          }}
          onAlwaysHide={() => {
            addAlwaysHide(contextMenu.node.name)
            closeContextMenu()
          }}
          onResetOverride={() => {
            removeOverride(contextMenu.node.name)
            closeContextMenu()
          }}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}
