import { h } from 'preact'
import { createPortal } from 'preact/compat'
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks'
import type { NormalizedNode, DevToolsConfig, TreeUpdateEvent, DockPosition, ActiveTab, ConsoleEntry, ToastItem, ActionSource, HighlightEntry, CommitRecord } from '../types'
import { FloatingIcon } from './FloatingIcon'
import { DetachedButton } from './DetachedButton'
import { Panel } from './Panel'
import { Highlight } from './Highlight'
import { ContextMenu } from './ContextMenu'
import { ToastContainer } from './ToastContainer'
import { startCapture } from '../console-capture'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'
import { devtoolsState } from './state-store'
import { openInEditor } from '../communication'
import type { PopupManager } from './popup-manager'
import { initPopupSideChannel } from './popup-manager'
import { STYLES } from './styles'

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

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

function computeUnionRect(elements: HTMLElement[]): DOMRect | null {
  let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity
  for (const el of elements) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    top = Math.min(top, r.top)
    left = Math.min(left, r.left)
    bottom = Math.max(bottom, r.bottom)
    right = Math.max(right, r.right)
  }
  if (top === Infinity) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

interface AppProps {
  config: DevToolsConfig
  popupManager?: PopupManager
}

export function App({ config, popupManager }: AppProps) {
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
  const [hideProviders, setHideProviders] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.HIDE_PROVIDERS) !== 'false'
  })
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.FONT_SIZE)
    return stored ? parseInt(stored, 10) : 11
  })
  const [editor, setEditor] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.EDITOR) ?? ''
  })
  const [showElements, setShowElements] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_ELEMENTS) === 'true'
  })
  const [showPreview, setShowPreview] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isPickerActive, setIsPickerActive] = useState(false)
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string> | null>(null)
  const [elementExpandedNodeIds, setElementExpandedNodeIds] = useState<Set<string> | null>(null)
  const [tree, setTree] = useState<NormalizedNode[]>([])
  const [selectedNode, setSelectedNode] = useState<NormalizedNode | null>(null)
  const reverseMapRef = useRef(new Map<HTMLElement, NormalizedNode>())
  const [highlights, setHighlights] = useState<Map<string, HighlightEntry>>(new Map())
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: NormalizedNode
  } | null>(null)
  const [editedProps, setEditedProps] = useState<Map<string, Set<string>>>(new Map())
  const [expandedPropsSet, setExpandedPropsSet] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)
  const [aiSelectedNodeIds, setAiSelectedNodeIds] = useState<Set<string>>(new Set())
  const [showAiActions, setShowAiActions] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_AI_ACTIONS) !== 'false'
  })
  const [mcpPaused, setMcpPaused] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.MCP_PAUSED) === 'true'
  })
  const [renderCauseEnabled, setRenderCauseEnabled] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.RENDER_CAUSE_ENABLED) === 'true'
  })
  const [renderHistorySize, setRenderHistorySize] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.RENDER_HISTORY_SIZE)
    return stored ? Math.max(10, parseInt(stored, 10) || 500) : 500
  })
  const [renderIncludeValues, setRenderIncludeValues] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.RENDER_INCLUDE_VALUES) !== 'false'
  })
  const [renderHistory, setRenderHistoryState] = useState<CommitRecord[]>([])
  const [renderHistoryRecording, setRenderHistoryRecordingState] = useState(true)
  const [pinnedRenderComponentId, setPinnedRenderComponentId] = useState<number | null>(null)
  const [commitComponentIds, setCommitComponentIds] = useState<Set<number> | null>(null)
  const renderHistorySizeRef = useRef(renderHistorySize)
  const renderHistoryRecordingRef = useRef(renderHistoryRecording)
  useEffect(() => { renderHistorySizeRef.current = renderHistorySize }, [renderHistorySize])
  useEffect(() => { renderHistoryRecordingRef.current = renderHistoryRecording }, [renderHistoryRecording])

  const [isDetached, setIsDetached] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.DETACHED) === '1'
  })
  const [popupMountPoint, setPopupMountPoint] = useState<HTMLElement | null>(null)
  const sideChannelCleanupRef = useRef<(() => void) | null>(null)

  // Listen for tree updates from the framework runtime
  useEffect(() => {
    function handleTreeUpdate(e: Event) {
      const { tree: newTree, commit } = (e as CustomEvent<TreeUpdateEvent>).detail
      setTree(newTree)
      devtoolsState.setTree(newTree)
      if (commit) {
        setCommitComponentIds(new Set(commit.components.map(c => c.persistentId)))
        if (renderHistoryRecordingRef.current) {
          setRenderHistoryState((prev) => {
            const cap = renderHistorySizeRef.current
            const next = prev.length >= cap ? [...prev.slice(-(cap - 1)), commit] : [...prev, commit]
            devtoolsState.setRenderHistory(next)
            return next
          })
        }
      } else {
        setCommitComponentIds(null)
      }
      // Rebuild reverse DOM → node map
      const map = new Map<HTMLElement, NormalizedNode>()
      buildReverseMap(newTree, map)
      reverseMapRef.current = map
      // Re-find the selected node in the new tree to get fresh props/hooks/state
      setSelectedNode((prev) => {
        if (!prev) return null
        const found = findNodeById(newTree, prev.id) ?? null
        devtoolsState.setSelectedNode(found)
        return found
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
        if (isDetached) {
          popupManager?.refocusPopup()
        } else {
          togglePanel()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [config.shortcut, isDetached, popupManager])

  // Capture console errors/warnings
  useEffect(() => {
    return startCapture((entry) => {
      setConsoleEntries((prev) => {
        const next = [...prev, entry]
        return next.length > 500 ? next.slice(-500) : next
      })
    })
  }, [])

  // Sync selected node to shared state store (for MCP bridge)
  useEffect(() => { devtoolsState.setSelectedNode(selectedNode) }, [selectedNode])

  // Sync console entries to shared state store (for MCP bridge)
  useEffect(() => { devtoolsState.setConsoleEntries(consoleEntries) }, [consoleEntries])

  // Listen for toast events from communication/runtime layers
  const MAX_TOASTS = 5
  useEffect(() => {
    function handleToast(e: Event) {
      const { type, message } = (e as CustomEvent).detail
      const id = `toast_${toastIdRef.current++}`
      setToasts((prev) => {
        let next = [...prev, { id, type, message, dismissedAt: null }]
        const visible = next.filter((t) => t.dismissedAt === null)
        if (visible.length > MAX_TOASTS) {
          const oldest = visible[0]
          next = next.map((t) =>
            t.id === oldest.id ? { ...t, dismissedAt: Date.now() } : t,
          )
        }
        return next
      })
    }
    window.addEventListener(EVENTS.TOAST, handleToast)
    return () => window.removeEventListener(EVENTS.TOAST, handleToast)
  }, [])

  // Auto-dismiss toasts after 15 seconds
  useEffect(() => {
    const active = toasts.filter((t) => t.dismissedAt === null)
    if (active.length === 0) return

    const timers = active.map((toast) => {
      return setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === toast.id && t.dismissedAt === null
              ? { ...t, dismissedAt: Date.now() }
              : t,
          ),
        )
      }, 15000)
    })

    return () => timers.forEach(clearTimeout)
  }, [toasts])

  // Push page content aside when panel is open
  useEffect(() => {
    const html = document.documentElement
    const cleanup = () => {
      html.style.marginLeft = ''
      html.style.marginRight = ''
      html.style.height = ''
      html.style.overflow = ''
    }

    if (!isOpen || isDetached) {
      cleanup()
      return
    }

    const marginPx = `${panelSize}px`
    html.style.marginLeft = ''
    html.style.marginRight = ''
    html.style.height = ''
    html.style.overflow = ''

    if (dockPosition === 'bottom') {
      html.style.height = `calc(100vh - ${panelSize}px)`
      html.style.overflow = 'auto'
    } else if (dockPosition === 'left') {
      html.style.marginLeft = marginPx
    } else {
      html.style.marginRight = marginPx
    }

    return cleanup
  }, [isOpen, isDetached, dockPosition, panelSize])

  // Wire popup-manager lifecycle callbacks
  useEffect(() => {
    if (!popupManager) return

    popupManager.onDetach((win) => {
      // Clean up any previous side-channel
      if (sideChannelCleanupRef.current) {
        sideChannelCleanupRef.current()
        sideChannelCleanupRef.current = null
      }

      // Create a mount point in the popup's body
      const mount = win.document.createElement('div')
      mount.className = 'devtools-root'
      mount.style.width = '100%'
      mount.style.height = '100vh'
      win.document.body.appendChild(mount)
      setPopupMountPoint(mount)
      setIsDetached(true)
      setIsOpen(false)

      // Set up reconnection handling in the popup
      sideChannelCleanupRef.current = initPopupSideChannel(
        win.document,
        (title) => {
          win.document.title = `Vite DevTools — ${title}`
        },
        () => {
          win.close()
        },
      )
    })

    popupManager.onDock(() => {
      // Clean up side-channel when docking
      if (sideChannelCleanupRef.current) {
        sideChannelCleanupRef.current()
        sideChannelCleanupRef.current = null
      }
      setPopupMountPoint(null)
      setIsDetached(false)
      setIsOpen(true)
    })

    popupManager.onReconnect((win) => {
      // Clean up any previous side-channel
      if (sideChannelCleanupRef.current) {
        sideChannelCleanupRef.current()
        sideChannelCleanupRef.current = null
      }

      // Clear existing body content (window.open('', name) may have stale content)
      const doc = win.document
      doc.body.innerHTML = ''

      // Re-inject styles into the popup
      const existingStyles = doc.head.querySelectorAll('style')
      existingStyles.forEach((s) => s.remove())
      const style = doc.createElement('style')
      style.textContent = STYLES
      doc.head.appendChild(style)

      // Set accent CSS custom properties on body
      const accent = config.accentColor ?? '#8b5cf6'
      doc.body.style.setProperty('--accent', accent)
      doc.body.style.setProperty('--accent-rgb', hexToRgb(accent))
      doc.body.style.margin = '0'
      doc.body.style.padding = '0'
      doc.body.style.background = '#18181b'
      doc.body.style.overflow = 'hidden'
      doc.body.style.fontFamily = "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace"

      // Create a fresh mount point in the popup's body
      const mount = doc.createElement('div')
      mount.className = 'devtools-root'
      mount.style.width = '100%'
      mount.style.height = '100vh'
      doc.body.appendChild(mount)

      // Set up reconnection handling in the popup
      sideChannelCleanupRef.current = initPopupSideChannel(
        doc,
        (title) => {
          doc.title = `Vite DevTools — ${title}`
        },
        () => {
          win.close()
        },
      )

      setPopupMountPoint(mount)
      setIsDetached(true)
    })

    const handleBeforeUnload = () => popupManager.notifyPageClosing()
    window.addEventListener('beforeunload', handleBeforeUnload)

    popupManager.attemptReconnect()

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // Clean up side-channel on unmount
      if (sideChannelCleanupRef.current) {
        sideChannelCleanupRef.current()
        sideChannelCleanupRef.current = null
      }
    }
  }, [popupManager])

  const errorCount = useMemo(
    () => consoleEntries.filter((e) => e.type === 'error').length,
    [consoleEntries],
  )

  // Search filter
  const { filteredTree, matchingNodeIds, searchAncestorIds } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return { filteredTree: tree, matchingNodeIds: null, searchAncestorIds: null }

    const matching = new Set<string>()
    const ancestors = new Set<string>()

    function collectMatches(nodes: NormalizedNode[]) {
      for (const node of nodes) {
        if (!node.isHostElement && node.name.toLowerCase().includes(query)) {
          matching.add(node.id)
        }
        collectMatches(node.children)
      }
    }

    function filterNodes(nodes: NormalizedNode[], parentPath: string[]): NormalizedNode[] {
      const result: NormalizedNode[] = []
      for (const node of nodes) {
        const isMatch = matching.has(node.id)
        const filteredChildren = filterNodes(node.children, [...parentPath, node.id])
        if (isMatch || filteredChildren.length > 0) {
          for (const id of parentPath) ancestors.add(id)
          ancestors.add(node.id)
          result.push({ ...node, children: filteredChildren })
        }
      }
      return result
    }

    collectMatches(tree)
    const filtered = filterNodes(tree, [])
    return { filteredTree: filtered, matchingNodeIds: matching, searchAncestorIds: ancestors }
  }, [tree, searchQuery])

  // Element picker mode
  useEffect(() => {
    if (!isPickerActive) return

    const devtoolsHost = document.getElementById('danendz-devtools')
    let lastNodeId: string | null = null

    function selectNode(node: NormalizedNode) {
      setSelectedNode(node)
      setActiveTab('inspect')
      const path = findNodePath(tree, node.id)
      if (path) {
        setExpandedNodeIds(new Set(path))
        // If the picked node is a host element, auto-expand component ancestors
        if (node.isHostElement) {
          const componentIds = new Set<string>()
          for (const id of path) {
            const n = findNodeById(tree, id)
            if (n && !n.isHostElement) componentIds.add(id)
          }
          if (componentIds.size > 0) setElementExpandedNodeIds(new Set(componentIds))
        }
      }
    }

    function handlePickerMove(e: MouseEvent) {
      // Use composedPath to pierce shadow DOM boundaries
      const target = (e.composedPath()[0] ?? e.target) as HTMLElement
      if (devtoolsHost?.contains(target)) return
      const node = findNodeForElement(target, reverseMapRef.current)
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
      const target = (e.composedPath()[0] ?? e.target) as HTMLElement
      if (devtoolsHost?.contains(target)) return
      e.preventDefault()
      e.stopPropagation()
      const node = findNodeForElement(target, reverseMapRef.current)
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
    setElementExpandedNodeIds(null)
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

  const handleHideProvidersToggle = useCallback(() => {
    setHideProviders((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.HIDE_PROVIDERS, String(next))
      window.dispatchEvent(new CustomEvent(EVENTS.REWALK))
      return next
    })
  }, [])

  const handleShowElementsToggle = useCallback(() => {
    setShowElements((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.SHOW_ELEMENTS, String(next))
      return next
    })
  }, [])

  const handleShowPreviewToggle = useCallback(() => {
    setShowPreview((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.SHOW_PREVIEW, String(next))
      return next
    })
  }, [])

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  const handleEditorChange = useCallback((value: string) => {
    setEditor(value)
    if (value) {
      localStorage.setItem(STORAGE_KEYS.EDITOR, value)
    } else {
      localStorage.removeItem(STORAGE_KEYS.EDITOR)
    }
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

  const [focusCommitIndex, setFocusCommitIndex] = useState<number | null>(null)

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
  }, [])

  const handleNavigateToCommit = useCallback((commitIndex: number) => {
    setActiveTab('renders')
    setFocusCommitIndex(commitIndex)
  }, [])

  const handleClearConsole = useCallback(() => {
    setConsoleEntries([])
  }, [])

  const handleFilterChange = useCallback((filters: { errors: boolean; warnings: boolean }) => {
    setConsoleFilters(filters)
  }, [])

  const handlePropEdit = useCallback((nodeId: string, propKey: string) => {
    setEditedProps((prev) => {
      const next = new Map(prev)
      const keys = new Set(next.get(nodeId) ?? [])
      keys.add(propKey)
      next.set(nodeId, keys)
      return next
    })
  }, [])

  const handlePropPersisted = useCallback((nodeId: string, propKey: string) => {
    setEditedProps((prev) => {
      const next = new Map(prev)
      const prevKeys = next.get(nodeId)
      if (prevKeys) {
        const newKeys = new Set(prevKeys)
        newKeys.delete(propKey)
        if (newKeys.size === 0) next.delete(nodeId)
        else next.set(nodeId, newKeys)
      }
      return next
    })
    // Notify client-runtime to remove from pending edits
    window.dispatchEvent(new CustomEvent(EVENTS.PROP_PERSISTED, {
      detail: { nodeId, propKey },
    }))
  }, [])

  const handleExpandProps = useCallback((nodeId: string) => {
    setExpandedPropsSet((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const handleSelect = useCallback((node: NormalizedNode) => {
    setSelectedNode(node)
    setContextMenu(null)
    setExpandedPropsSet(new Set())
  }, [])

  const handleHover = useCallback((node: NormalizedNode | null) => {
    setHighlights(prev => {
      const next = new Map(prev)
      if (!node || !node._domElements?.length) {
        next.delete('user')
      } else {
        const rect = computeUnionRect(node._domElements)
        if (!rect) { next.delete('user'); return next }
        next.set('user', { id: 'user', rect, name: node.name, source: 'user', domElements: node._domElements, persist: false })
      }
      return next
    })
  }, [])

  const handleClearAiHighlight = useCallback(() => {
    setHighlights(prev => {
      if (!prev.has('ai')) return prev
      const next = new Map(prev)
      next.delete('ai')
      return next
    })
  }, [])

  // Register MCP action callbacks (must be after handleSelect/handleHover declarations)
  useEffect(() => {
    devtoolsState.onSelectNode = (node: NormalizedNode) => {
      handleSelect(node)
      setActiveTab('inspect')
      const path = findNodePath(devtoolsState.tree, node.id)
      if (path) setExpandedNodeIds(new Set(path))
      setAiSelectedNodeIds(prev => new Set(prev).add(node.id))
      setTimeout(() => {
        setAiSelectedNodeIds(prev => {
          const next = new Set(prev)
          next.delete(node.id)
          return next
        })
      }, 5000)
    }
    devtoolsState.onHighlight = (node: NormalizedNode | null, source?: ActionSource, persist?: boolean) => {
      setHighlights(prev => {
        const next = new Map(prev)
        if (!node) {
          next.delete('ai')
          return next
        }
        if (!node._domElements?.length) return prev
        // Scroll into view for AI highlights
        if (source === 'ai') {
          node._domElements[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        const rect = computeUnionRect(node._domElements)
        if (!rect) return prev
        const gen = Date.now()
        next.set('ai', { id: 'ai', rect, name: node.name, source: source ?? 'ai', domElements: node._domElements, persist: !!persist, _gen: gen })
        return next
      })
      // Auto-clear non-persistent AI highlights
      if (node && !persist) {
        const gen = Date.now()
        setTimeout(() => {
          setHighlights(prev => {
            const entry = prev.get('ai')
            if (!entry || entry.persist || entry._gen !== gen) return prev
            const next = new Map(prev)
            next.delete('ai')
            return next
          })
        }, 3000)
      }
    }
    return () => {
      devtoolsState.onSelectNode = null
      devtoolsState.onHighlight = null
    }
  }, [handleSelect])

  // rAF live-tracking: recompute highlight rects each frame while any highlights exist
  const hasHighlights = highlights.size > 0
  useEffect(() => {
    if (!hasHighlights) return
    let rafId: number
    function tick() {
      setHighlights(prev => {
        let changed = false
        const next = new Map(prev)
        for (const [id, entry] of next) {
          if (!entry.domElements.length) continue
          const rect = computeUnionRect(entry.domElements)
          if (!rect) {
            next.delete(id)
            changed = true
          } else if (rect.top !== entry.rect.top || rect.left !== entry.rect.left
            || rect.width !== entry.rect.width || rect.height !== entry.rect.height) {
            next.set(id, { ...entry, rect })
            changed = true
          }
        }
        return changed ? next : prev
      })
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [hasHighlights])

  const handleContextMenu = useCallback((e: MouseEvent, node: NormalizedNode) => {
    if (!node.source) return
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleToastDismiss = useCallback((id: string) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id)
      if (!toast) return prev
      if (toast.dismissedAt === null) {
        return prev.map((t) =>
          t.id === id ? { ...t, dismissedAt: Date.now() } : t,
        )
      }
      return prev.filter((t) => t.id !== id)
    })
  }, [])

  const handleMcpPausedToggle = useCallback(() => {
    setMcpPaused((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.MCP_PAUSED, String(next))
      return next
    })
  }, [])

  const handleShowAiActionsToggle = useCallback(() => {
    setShowAiActions((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.SHOW_AI_ACTIONS, String(next))
      return next
    })
  }, [])

  const handleRenderCauseToggle = useCallback(() => {
    setRenderCauseEnabled((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.RENDER_CAUSE_ENABLED, String(next))
      window.dispatchEvent(new CustomEvent(EVENTS.REWALK))
      return next
    })
  }, [])

  const handleRenderHistorySizeChange = useCallback((size: number) => {
    const clamped = Math.max(10, Math.min(2000, size))
    setRenderHistorySize(clamped)
    localStorage.setItem(STORAGE_KEYS.RENDER_HISTORY_SIZE, String(clamped))
  }, [])

  const handleRenderIncludeValuesToggle = useCallback(() => {
    setRenderIncludeValues((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.RENDER_INCLUDE_VALUES, String(next))
      return next
    })
  }, [])

  const handleRenderHistoryRecordingToggle = useCallback(() => {
    setRenderHistoryRecordingState((prev) => {
      const next = !prev
      devtoolsState.setRenderHistoryRecording(next)
      return next
    })
  }, [])

  const handleClearRenderHistory = useCallback(() => {
    setRenderHistoryState([])
    devtoolsState.setRenderHistory([])
  }, [])

  const handlePinRenderComponent = useCallback((persistentId: number | null) => {
    setPinnedRenderComponentId(persistentId)
    setActiveTab('renders')
  }, [])

  const handleDetach = useCallback(() => {
    popupManager?.detach()
  }, [popupManager])

  const handleDockBack = useCallback(() => {
    popupManager?.dock()
  }, [popupManager])

  const handleRefocusPopup = useCallback(() => {
    popupManager?.refocusPopup()
  }, [popupManager])

  // Wire MCP control hooks so agents can toggle recording / clear history
  useEffect(() => {
    devtoolsState.onClearRenderHistory = handleClearRenderHistory
    devtoolsState.onSetRenderHistoryRecording = (enabled: boolean) => {
      setRenderHistoryRecordingState(enabled)
      devtoolsState.setRenderHistoryRecording(enabled)
    }
    return () => {
      devtoolsState.onClearRenderHistory = null
      devtoolsState.onSetRenderHistoryRecording = null
    }
  }, [handleClearRenderHistory])

  const panelElement = (
    <Panel
      tree={filteredTree}
      selectedNode={selectedNode}
      dockPosition={dockPosition}
      panelSize={panelSize}
      activeTab={activeTab}
      searchQuery={searchQuery}
      matchingNodeIds={matchingNodeIds}
      searchAncestorIds={searchAncestorIds}
      consoleEntries={consoleEntries}
      consoleFilters={consoleFilters}
      errorCount={errorCount}
      isPickerActive={isPickerActive}
      expandedNodeIds={expandedNodeIds}
      elementExpandedNodeIds={elementExpandedNodeIds}
      showElements={showElements}
      settingsOpen={settingsOpen}
      hideLibrary={hideLibrary}
      hideProviders={hideProviders}
      editor={editor}
      fontSize={fontSize}
      supportedSettings={config.supportedSettings}
      onSearchChange={handleSearchChange}
      onPickerToggle={handlePickerToggle}
      onSettingsToggle={handleSettingsToggle}
      onHideLibraryToggle={handleHideLibraryToggle}
      onHideProvidersToggle={handleHideProvidersToggle}
      onShowElementsToggle={handleShowElementsToggle}
      showPreview={showPreview}
      onShowPreviewToggle={handleShowPreviewToggle}
      onEditorChange={handleEditorChange}
      onFontSizeChange={handleFontSizeChange}
      onDockChange={handleDockChange}
      onResize={handleResize}
      onTabChange={handleTabChange}
      onFilterChange={handleFilterChange}
      onClearConsole={handleClearConsole}
      editedProps={editedProps}
      expandedPropsSet={expandedPropsSet}
      mcpEnabled={config.mcp ?? false}
      mcpPaused={mcpPaused}
      aiHighlightActive={highlights.has('ai')}
      aiSelectedNodeIds={aiSelectedNodeIds}
      showAiActions={showAiActions}
      onClearAiHighlight={handleClearAiHighlight}
      onMcpPausedToggle={handleMcpPausedToggle}
      onShowAiActionsToggle={handleShowAiActionsToggle}
      onPropEdit={handlePropEdit}
      onPropPersisted={handlePropPersisted}
      onExpandProps={handleExpandProps}
      onSelect={handleSelect}
      onHover={handleHover}
      onContextMenu={handleContextMenu}
      onClose={isDetached ? handleDockBack : togglePanel}
      mode={isDetached ? 'popup' : 'docked'}
      onDetach={popupManager ? handleDetach : undefined}
      onDockBack={handleDockBack}
      renderCauseEnabled={renderCauseEnabled}
      renderHistorySize={renderHistorySize}
      renderIncludeValues={renderIncludeValues}
      renderHistory={renderHistory}
      renderHistoryRecording={renderHistoryRecording}
      pinnedRenderComponentId={pinnedRenderComponentId}
      commitComponentIds={commitComponentIds}
      onRenderCauseToggle={handleRenderCauseToggle}
      onRenderHistorySizeChange={handleRenderHistorySizeChange}
      onRenderIncludeValuesToggle={handleRenderIncludeValuesToggle}
      onRenderHistoryRecordingToggle={handleRenderHistoryRecordingToggle}
      onClearRenderHistory={handleClearRenderHistory}
      onPinRenderComponent={handlePinRenderComponent}
      onNavigateToCommit={handleNavigateToCommit}
      focusCommitIndex={focusCommitIndex}
      onFocusCommitConsumed={() => setFocusCommitIndex(null)}
    />
  )

  return (
    <div>
      <Highlight highlights={Array.from(highlights.values())} showAiActions={showAiActions} />

      {isDetached ? (
        <>
          <DetachedButton onRefocus={handleRefocusPopup} />
          {popupMountPoint && createPortal(panelElement, popupMountPoint)}
        </>
      ) : (
        <>
          {!isOpen && <FloatingIcon onClick={togglePanel} />}
          {isOpen && panelElement}
        </>
      )}

      {contextMenu && contextMenu.node.source && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: `Open source — ${contextMenu.node.source.fileName.replace(/^.*\/src\//, 'src/')}:${contextMenu.node.source.lineNumber}`,
              onClick: () => openInEditor(contextMenu.node.source!),
            },
            ...(contextMenu.node.usageSource ? [{
              label: `Open usage — ${contextMenu.node.usageSource.fileName.replace(/^.*\/src\//, 'src/')}:${contextMenu.node.usageSource.lineNumber}`,
              onClick: () => openInEditor(contextMenu.node.usageSource!),
            }] : []),
          ]}
          onClose={closeContextMenu}
        />
      )}

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} dockPosition={dockPosition} onDismiss={handleToastDismiss} />
      )}
    </div>
  )
}
