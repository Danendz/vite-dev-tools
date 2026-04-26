import { h } from "preact";
import { createPortal } from "preact/compat";
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "preact/hooks";
import type {
  NormalizedNode,
  DevToolsConfig,
  TreeUpdateEvent,
  DockPosition,
  ActiveTab,
  ConsoleEntry,
  ToastItem,
  ActionSource,
  HighlightEntry,
  CommitRecord,
} from "../types";
import { FloatingIcon } from "./FloatingIcon";
import { DetachedButton } from "./DetachedButton";
import { Panel } from "./Panel";
import { Highlight } from "./Highlight";
import { ContextMenu } from "./ContextMenu";
import { ToastContainer } from "./ToastContainer";
import { startCapture } from "../console-capture";
import { createFrameResolver } from "../frame-resolver";
import { EVENTS, STORAGE_KEYS } from "../../shared/constants";
import { devtoolsState } from "./state-store";
import { openInEditor } from "../communication";
import { attributeError, flattenTree } from "../error-attribution";
import type { PopupManager } from "./popup-manager";
import type { Locale } from "./i18n";
import { I18nContext, createI18nValue, SUPPORTED_LOCALES } from "./i18n";

function findNodeById(
  nodes: NormalizedNode[],
  id: string,
): NormalizedNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

function buildReverseMap(
  nodes: NormalizedNode[],
  map: Map<HTMLElement, NormalizedNode>,
) {
  for (const node of nodes) {
    if (node._domElements) {
      for (const el of node._domElements) {
        map.set(el, node);
      }
    }
    buildReverseMap(node.children, map);
  }
}

function findNodeForElement(
  el: HTMLElement | null,
  map: Map<HTMLElement, NormalizedNode>,
): NormalizedNode | null {
  while (el) {
    const node = map.get(el);
    if (node) return node;
    el = el.parentElement;
  }
  return null;
}

function findNodePath(
  nodes: NormalizedNode[],
  targetId: string,
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return [node.id];
    const childPath = findNodePath(node.children, targetId);
    if (childPath) return [node.id, ...childPath];
  }
  return null;
}

function computeUnionRect(elements: HTMLElement[]): DOMRect | null {
  let top = Infinity,
    left = Infinity,
    bottom = -Infinity,
    right = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    bottom = Math.max(bottom, r.bottom);
    right = Math.max(right, r.right);
  }
  if (top === Infinity) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEYS.LOCALE);
  if (stored && SUPPORTED_LOCALES.some((l) => l.id === stored))
    return stored as Locale;
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("zh")) return "zh";
  if (nav.startsWith("ru")) return "ru";
  return "en";
}

interface AppProps {
  config: DevToolsConfig;
  popupManager?: PopupManager;
}

export function App({ config, popupManager }: AppProps) {
  const [isOpen, setIsOpen] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PANEL_OPEN);
    if (stored !== null) return stored === "true";
    return config.open ?? false;
  });
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.DOCK_POSITION);
    if (stored === "left" || stored === "right" || stored === "bottom")
      return stored;
    return "bottom";
  });
  const [panelSize, setPanelSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PANEL_SIZE);
    if (stored) {
      const num = parseInt(stored, 10);
      if (!isNaN(num) && num > 0) return num;
    }
    return 300;
  });
  const [activeTab, setActiveTab] = useState<ActiveTab>("inspect");
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [consoleFilters, setConsoleFilters] = useState<{
    errors: boolean;
    warnings: boolean;
    logs: boolean;
  }>({
    errors: true,
    warnings: true,
    logs: true,
  });
  const [consoleStripLibrary, setConsoleStripLibrary] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.CONSOLE_STRIP_LIBRARY) === "true";
  });
  const [clearConsoleOnReload, setClearConsoleOnReload] = useState(() => {
    return (
      localStorage.getItem(STORAGE_KEYS.CLEAR_CONSOLE_ON_RELOAD) === "true"
    );
  });
  const clearConsoleOnReloadRef = useRef(false);
  clearConsoleOnReloadRef.current = clearConsoleOnReload;
  const [hideLibrary, setHideLibrary] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.HIDE_LIBRARY) !== "false";
  });
  const [hideProviders, setHideProviders] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.HIDE_PROVIDERS) !== "false";
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
    return stored ? parseInt(stored, 10) : 11;
  });
  const [editor, setEditor] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.EDITOR) ?? "";
  });
  const [showElements, setShowElements] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_ELEMENTS) === "true";
  });
  const [showPreview, setShowPreview] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== "false";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string> | null>(
    null,
  );
  const [elementExpandedNodeIds, setElementExpandedNodeIds] =
    useState<Set<string> | null>(null);
  const [tree, setTree] = useState<NormalizedNode[]>([]);
  const treeRef = useRef<NormalizedNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<NormalizedNode | null>(null);
  const reverseMapRef = useRef(new Map<HTMLElement, NormalizedNode>());
  const [highlights, setHighlights] = useState<Map<string, HighlightEntry>>(
    new Map(),
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: NormalizedNode;
  } | null>(null);
  const [editedProps, setEditedProps] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [expandedPropsSet, setExpandedPropsSet] = useState<Set<string>>(
    new Set(),
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const [aiSelectedNodeIds, setAiSelectedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [showAiActions, setShowAiActions] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_AI_ACTIONS) !== "false";
  });
  const [mcpPaused, setMcpPaused] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.MCP_PAUSED) === "true";
  });
  const [renderCauseEnabled, setRenderCauseEnabled] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.RENDER_CAUSE_ENABLED) === "true";
  });
  const [renderHistorySize, setRenderHistorySize] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.RENDER_HISTORY_SIZE);
    return stored ? Math.max(10, parseInt(stored, 10) || 500) : 500;
  });
  const [renderIncludeValues, setRenderIncludeValues] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.RENDER_INCLUDE_VALUES) !== "false";
  });
  const [renderHistory, setRenderHistoryState] = useState<CommitRecord[]>([]);
  const [renderHistoryRecording, setRenderHistoryRecordingState] =
    useState(true);
  const [pinnedRenderComponentId, setPinnedRenderComponentId] = useState<
    number | null
  >(null);
  const [commitComponentIds, setCommitComponentIds] =
    useState<Set<number> | null>(null);
  const renderHistorySizeRef = useRef(renderHistorySize);
  const renderHistoryRecordingRef = useRef(renderHistoryRecording);
  useEffect(() => {
    renderHistorySizeRef.current = renderHistorySize;
  }, [renderHistorySize]);
  useEffect(() => {
    renderHistoryRecordingRef.current = renderHistoryRecording;
  }, [renderHistoryRecording]);

  const [isDetached, setIsDetached] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.DETACHED) === "1";
  });
  const [popupMountPoint, setPopupMountPoint] = useState<HTMLElement | null>(
    null,
  );

  const [locale, setLocale] = useState<Locale>(detectLocale);
  const handleLocaleChange = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem(STORAGE_KEYS.LOCALE, newLocale);
  }, []);
  const i18nValue = useMemo(() => createI18nValue(locale), [locale]);

  // Listen for tree updates from the framework runtime
  useEffect(() => {
    function handleTreeUpdate(e: Event) {
      const { tree: newTree, commit } = (e as CustomEvent<TreeUpdateEvent>)
        .detail;
      setTree(newTree);
      treeRef.current = newTree;
      devtoolsState.setTree(newTree);
      if (commit) {
        setCommitComponentIds(
          new Set(commit.components.map((c) => c.persistentId)),
        );
        if (renderHistoryRecordingRef.current) {
          setRenderHistoryState((prev) => {
            const cap = renderHistorySizeRef.current;
            const next =
              prev.length >= cap
                ? [...prev.slice(-(cap - 1)), commit]
                : [...prev, commit];
            devtoolsState.setRenderHistory(next);
            return next;
          });
        }
      } else {
        setCommitComponentIds(null);
      }
      // Rebuild reverse DOM → node map
      const map = new Map<HTMLElement, NormalizedNode>();
      buildReverseMap(newTree, map);
      reverseMapRef.current = map;
      // Re-find the selected node in the new tree to get fresh props/hooks/state
      setSelectedNode((prev) => {
        if (!prev) return null;
        const found = findNodeById(newTree, prev.id) ?? null;
        devtoolsState.setSelectedNode(found);
        return found;
      });
      // Re-attribute all errors/warnings against the fresh tree.
      // Vue resets nodeIds on every walk, so always re-attribute to stay in sync.
      setConsoleEntries((prev) => {
        if (prev.length === 0) return prev;
        let changed = false;
        const next = prev.map((entry) => {
          if (entry.type === "log" || !entry.frames?.length) return entry;
          const updated: ConsoleEntry = {
            ...entry,
            ownedBy: undefined,
            caughtBy: undefined,
            snapshot: undefined,
          };
          attributeError(updated, newTree);
          const oldId = entry.ownedBy?.nodeId;
          const newId = updated.ownedBy?.nodeId;
          if (oldId !== newId) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
    }
    window.addEventListener(EVENTS.TREE_UPDATE, handleTreeUpdate);
    return () =>
      window.removeEventListener(EVENTS.TREE_UPDATE, handleTreeUpdate);
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const shortcut = config.shortcut ?? "ctrl+shift+d";
      const parts = shortcut.toLowerCase().split("+");
      const needCtrl = parts.includes("ctrl");
      const needShift = parts.includes("shift");
      const needAlt = parts.includes("alt");
      const key = parts.find(
        (p) => !["ctrl", "shift", "alt", "meta"].includes(p),
      );

      if (
        e.ctrlKey === needCtrl &&
        e.shiftKey === needShift &&
        e.altKey === needAlt &&
        e.key.toLowerCase() === key
      ) {
        e.preventDefault();
        if (isDetached) {
          popupManager?.refocusPopup();
        } else {
          togglePanel();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [config.shortcut, isDetached, popupManager]);

  // Capture console errors/warnings with source map resolution and grouping
  useEffect(() => {
    const resolver = createFrameResolver();

    resolver.onResolved((resolvedEntries) => {
      setConsoleEntries((prev) => {
        let next = [...prev];
        for (const entry of resolvedEntries) {
          // Compute group key from resolved first user frame
          const userFrame = entry.frames?.find((f) => !f.isLibrary);
          const groupKey = userFrame
            ? `${entry.type}:${entry.message}:${userFrame.file}:${userFrame.line}:${userFrame.col}`
            : `${entry.type}:${entry.message}`;
          const resolved = { ...entry, groupKey };

          // Attribute errors/warnings to owning component at capture time
          if (resolved.type !== "log" && treeRef.current.length > 0) {
            attributeError(resolved, treeRef.current);
          }

          // Try to find existing group
          const existingIndex = next.findIndex((e) => e.groupKey === groupKey);
          if (existingIndex !== -1) {
            const existing = next[existingIndex];
            next[existingIndex] = {
              ...resolved,
              count: existing.count + 1,
              id: existing.id,
              timestamp: entry.timestamp,
              // Preserve existing attribution if new attribution failed
              ownedBy: resolved.ownedBy ?? existing.ownedBy,
              caughtBy: resolved.caughtBy ?? existing.caughtBy,
              snapshot: resolved.snapshot ?? existing.snapshot,
            };
          } else {
            next.push(resolved);
          }
        }
        if (next.length > 500) next = next.slice(-500);
        return next;
      });
    });

    const stopCapture = startCapture((entry) => {
      resolver.resolve([entry]);
    });

    return () => {
      stopCapture();
      resolver.destroy();
    };
  }, []);

  // Clear console on HMR hot update (if setting enabled)
  useEffect(() => {
    if (!(import.meta as any).hot) return;
    const hot = (import.meta as any).hot;
    hot.on("vite:beforeUpdate", () => {
      if (clearConsoleOnReloadRef.current) {
        setConsoleEntries([]);
      }
    });
  }, []);

  // Sync selected node to shared state store (for MCP bridge)
  useEffect(() => {
    devtoolsState.setSelectedNode(selectedNode);
  }, [selectedNode]);

  // Sync console entries to shared state store (for MCP bridge)
  useEffect(() => {
    devtoolsState.setConsoleEntries(consoleEntries);
  }, [consoleEntries]);

  // Listen for toast events from communication/runtime layers
  const MAX_TOASTS = 5;
  useEffect(() => {
    function handleToast(e: Event) {
      const { type, message } = (e as CustomEvent).detail;
      const id = `toast_${toastIdRef.current++}`;
      setToasts((prev) => {
        let next = [...prev, { id, type, message, dismissedAt: null }];
        const visible = next.filter((t) => t.dismissedAt === null);
        if (visible.length > MAX_TOASTS) {
          const oldest = visible[0];
          next = next.map((t) =>
            t.id === oldest.id ? { ...t, dismissedAt: Date.now() } : t,
          );
        }
        return next;
      });
    }
    window.addEventListener(EVENTS.TOAST, handleToast);
    return () => window.removeEventListener(EVENTS.TOAST, handleToast);
  }, []);

  // Auto-dismiss toasts after 15 seconds
  useEffect(() => {
    const active = toasts.filter((t) => t.dismissedAt === null);
    if (active.length === 0) return;

    const timers = active.map((toast) => {
      return setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === toast.id && t.dismissedAt === null
              ? { ...t, dismissedAt: Date.now() }
              : t,
          ),
        );
      }, 15000);
    });

    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  // Push page content aside when panel is open
  useEffect(() => {
    const html = document.documentElement;
    const cleanup = () => {
      html.style.marginLeft = "";
      html.style.marginRight = "";
      html.style.height = "";
      html.style.overflow = "";
    };

    if (!isOpen || isDetached) {
      cleanup();
      return;
    }

    const marginPx = `${panelSize}px`;
    html.style.marginLeft = "";
    html.style.marginRight = "";
    html.style.height = "";
    html.style.overflow = "";

    if (dockPosition === "bottom") {
      html.style.height = `calc(100vh - ${panelSize}px)`;
      html.style.overflow = "auto";
    } else if (dockPosition === "left") {
      html.style.marginLeft = marginPx;
    } else {
      html.style.marginRight = marginPx;
    }

    return cleanup;
  }, [isOpen, isDetached, dockPosition, panelSize]);

  // Wire popup-manager lifecycle callbacks
  useEffect(() => {
    if (!popupManager) return;

    popupManager.onDetach((win) => {
      // Create a mount point in the popup's body
      const mount = win.document.createElement("div");
      mount.className = "devtools-root";
      mount.style.width = "100%";
      mount.style.height = "100vh";
      win.document.body.appendChild(mount);
      setPopupMountPoint(mount);
      setIsDetached(true);
      setIsOpen(false);
    });

    popupManager.onDock(() => {
      setPopupMountPoint(null);
      setIsDetached(false);
      setIsOpen(true);
    });

    popupManager.onReconnect((win) => {
      // popup-manager already re-injected styles via injectIntoPopup.
      // We just need to create a fresh mount point for the portal.
      const doc = win.document;

      // Clear any stale mount points
      const existing = doc.querySelector(".devtools-root");
      if (existing) existing.remove();

      const mount = doc.createElement("div");
      mount.className = "devtools-root";
      mount.style.width = "100%";
      mount.style.height = "100vh";
      doc.body.appendChild(mount);

      setPopupMountPoint(mount);
      setIsDetached(true);
    });

    const handleBeforeUnload = () => popupManager.notifyPageClosing();
    window.addEventListener("beforeunload", handleBeforeUnload);

    popupManager.attemptReconnect();

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [popupManager]);

  const errorCount = useMemo(
    () => consoleEntries.filter((e) => e.type === "error").length,
    [consoleEntries],
  );

  // Search filter
  const { filteredTree, matchingNodeIds, searchAncestorIds } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query)
      return {
        filteredTree: tree,
        matchingNodeIds: null,
        searchAncestorIds: null,
      };

    const matching = new Set<string>();
    const ancestors = new Set<string>();

    function collectMatches(nodes: NormalizedNode[]) {
      for (const node of nodes) {
        if (!node.isHostElement && node.name.toLowerCase().includes(query)) {
          matching.add(node.id);
        }
        collectMatches(node.children);
      }
    }

    function filterNodes(
      nodes: NormalizedNode[],
      parentPath: string[],
    ): NormalizedNode[] {
      const result: NormalizedNode[] = [];
      for (const node of nodes) {
        const isMatch = matching.has(node.id);
        const filteredChildren = filterNodes(node.children, [
          ...parentPath,
          node.id,
        ]);
        if (isMatch || filteredChildren.length > 0) {
          for (const id of parentPath) ancestors.add(id);
          ancestors.add(node.id);
          result.push({ ...node, children: filteredChildren });
        }
      }
      return result;
    }

    collectMatches(tree);
    const filtered = filterNodes(tree, []);
    return {
      filteredTree: filtered,
      matchingNodeIds: matching,
      searchAncestorIds: ancestors,
    };
  }, [tree, searchQuery]);

  // Error count map: nodeId → bubbled error count (own + descendant errors)
  const [errorFilterActive, setErrorFilterActive] = useState(false);
  const { errorCountMap, directErrorMap, nodeHasError, errorAncestorIds } =
    useMemo(() => {
      const directCounts = new Map<string, number>();
      const directHasError = new Set<string>();
      for (const entry of consoleEntries) {
        if (entry.type === "log" || !entry.ownedBy) continue;
        const nodeId = entry.ownedBy.nodeId;
        directCounts.set(nodeId, (directCounts.get(nodeId) ?? 0) + 1);
        if (entry.type === "error") directHasError.add(nodeId);
      }

      // Bubble up: walk tree, accumulate children's counts into parents
      const bubbled = new Map<string, number>();
      const hasError = new Set<string>();
      function walk(nodes: NormalizedNode[]): {
        sum: number;
        anyError: boolean;
      } {
        let sum = 0;
        let anyError = false;
        for (const node of nodes) {
          const own = directCounts.get(node.id) ?? 0;
          const ownHasErr = directHasError.has(node.id);
          const child = walk(node.children);
          const total = own + child.sum;
          if (total > 0) bubbled.set(node.id, total);
          if (ownHasErr || child.anyError) {
            hasError.add(node.id);
            anyError = true;
          }
          sum += total;
        }
        return { sum, anyError };
      }
      walk(tree);

      // Compute errorAncestorIds for filter mode
      let ancestors: Set<string> | null = null;
      if (errorFilterActive && bubbled.size > 0) {
        ancestors = new Set<string>();
        function collectPaths(nodes: NormalizedNode[], parentPath: string[]) {
          for (const node of nodes) {
            if (bubbled.has(node.id)) {
              for (const id of parentPath) ancestors!.add(id);
              ancestors!.add(node.id);
            }
            collectPaths(node.children, [...parentPath, node.id]);
          }
        }
        collectPaths(tree, []);
      }

      return {
        errorCountMap: bubbled,
        directErrorMap: directCounts,
        nodeHasError: hasError,
        errorAncestorIds: ancestors,
      };
    }, [consoleEntries, tree, errorFilterActive]);

  // Element picker mode
  useEffect(() => {
    if (!isPickerActive) return;

    const devtoolsHost = document.getElementById("danendz-devtools");
    let lastNodeId: string | null = null;

    function selectNode(node: NormalizedNode) {
      setSelectedNode(node);
      setActiveTab("inspect");
      const path = findNodePath(tree, node.id);
      if (path) {
        setExpandedNodeIds(new Set(path));
        // If the picked node is a host element, auto-expand component ancestors
        if (node.isHostElement) {
          const componentIds = new Set<string>();
          for (const id of path) {
            const n = findNodeById(tree, id);
            if (n && !n.isHostElement) componentIds.add(id);
          }
          if (componentIds.size > 0)
            setElementExpandedNodeIds(new Set(componentIds));
        }
      }
    }

    function handlePickerMove(e: MouseEvent) {
      // Use composedPath to pierce shadow DOM boundaries
      const target = (e.composedPath()[0] ?? e.target) as HTMLElement;
      if (devtoolsHost?.contains(target)) return;
      const node = findNodeForElement(target, reverseMapRef.current);
      if (node) {
        handleHover(node);
        // Select in tree on hover, but skip if same node
        if (node.id !== lastNodeId) {
          lastNodeId = node.id;
          selectNode(node);
        }
      } else {
        handleHover(null);
        lastNodeId = null;
      }
    }

    function handlePickerClick(e: MouseEvent) {
      const target = (e.composedPath()[0] ?? e.target) as HTMLElement;
      if (devtoolsHost?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      const node = findNodeForElement(target, reverseMapRef.current);
      if (node) {
        selectNode(node);
        handleHover(node);
      }
      setIsPickerActive(false);
    }

    function handlePickerKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsPickerActive(false);
        handleHover(null);
      }
    }

    document.addEventListener("mousemove", handlePickerMove, true);
    document.addEventListener("click", handlePickerClick, true);
    document.addEventListener("keydown", handlePickerKey, true);

    return () => {
      document.removeEventListener("mousemove", handlePickerMove, true);
      document.removeEventListener("click", handlePickerClick, true);
      document.removeEventListener("keydown", handlePickerKey, true);
      handleHover(null);
    };
  }, [isPickerActive, tree]);

  const handlePickerToggle = useCallback(() => {
    setIsPickerActive((prev) => !prev);
    setExpandedNodeIds(null);
    setElementExpandedNodeIds(null);
  }, []);

  const handleSettingsToggle = useCallback(() => {
    setSettingsOpen((prev) => !prev);
  }, []);

  const handleHideLibraryToggle = useCallback(() => {
    setHideLibrary((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.HIDE_LIBRARY, String(next));
      window.dispatchEvent(new CustomEvent(EVENTS.REWALK));
      return next;
    });
  }, []);

  const handleHideProvidersToggle = useCallback(() => {
    setHideProviders((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.HIDE_PROVIDERS, String(next));
      window.dispatchEvent(new CustomEvent(EVENTS.REWALK));
      return next;
    });
  }, []);

  const handleShowElementsToggle = useCallback(() => {
    setShowElements((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.SHOW_ELEMENTS, String(next));
      return next;
    });
  }, []);

  const handleShowPreviewToggle = useCallback(() => {
    setShowPreview((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.SHOW_PREVIEW, String(next));
      return next;
    });
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    setEditor(value);
    if (value) {
      localStorage.setItem(STORAGE_KEYS.EDITOR, value);
    } else {
      localStorage.removeItem(STORAGE_KEYS.EDITOR);
    }
  }, []);

  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size);
    localStorage.setItem(STORAGE_KEYS.FONT_SIZE, String(size));
  }, []);

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.PANEL_OPEN, String(next));
      return next;
    });
  }, []);

  const handleDockChange = useCallback((pos: DockPosition) => {
    setDockPosition(pos);
    localStorage.setItem(STORAGE_KEYS.DOCK_POSITION, pos);
    const defaultSize = pos === "bottom" ? 300 : 360;
    setPanelSize(defaultSize);
    localStorage.setItem(STORAGE_KEYS.PANEL_SIZE, String(defaultSize));
  }, []);

  const handleResize = useCallback((newSize: number) => {
    setPanelSize(newSize);
    localStorage.setItem(STORAGE_KEYS.PANEL_SIZE, String(newSize));
  }, []);

  const [focusCommitIndex, setFocusCommitIndex] = useState<number | null>(null);

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
  }, []);

  const handleNavigateToCommit = useCallback((commitIndex: number) => {
    setActiveTab("renders");
    setFocusCommitIndex(commitIndex);
  }, []);

  const handleClearConsole = useCallback(() => {
    setConsoleEntries([]);
  }, []);

  const handleFilterChange = useCallback(
    (filters: { errors: boolean; warnings: boolean; logs: boolean }) => {
      setConsoleFilters(filters);
    },
    [],
  );

  const handleConsoleStripLibraryToggle = useCallback(() => {
    setConsoleStripLibrary((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.CONSOLE_STRIP_LIBRARY, String(next));
      return next;
    });
  }, []);

  const handleClearConsoleOnReloadToggle = useCallback(() => {
    setClearConsoleOnReload((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.CLEAR_CONSOLE_ON_RELOAD, String(next));
      return next;
    });
  }, []);

  const handlePropEdit = useCallback((nodeId: string, propKey: string) => {
    setEditedProps((prev) => {
      const next = new Map(prev);
      const keys = new Set(next.get(nodeId) ?? []);
      keys.add(propKey);
      next.set(nodeId, keys);
      return next;
    });
  }, []);

  const handlePropPersisted = useCallback((nodeId: string, propKey: string) => {
    setEditedProps((prev) => {
      const next = new Map(prev);
      const prevKeys = next.get(nodeId);
      if (prevKeys) {
        const newKeys = new Set(prevKeys);
        newKeys.delete(propKey);
        if (newKeys.size === 0) next.delete(nodeId);
        else next.set(nodeId, newKeys);
      }
      return next;
    });
    // Notify client-runtime to remove from pending edits
    window.dispatchEvent(
      new CustomEvent(EVENTS.PROP_PERSISTED, {
        detail: { nodeId, propKey },
      }),
    );
  }, []);

  const handleExpandProps = useCallback((nodeId: string) => {
    setExpandedPropsSet((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback((node: NormalizedNode) => {
    setSelectedNode(node);
    setContextMenu(null);
    setExpandedPropsSet(new Set());
  }, []);

  const [highlightedProp, setHighlightedProp] = useState<{
    nodeId: string;
    propName: string;
  } | null>(null);

  const handlePropSourceClick = useCallback(
    (componentId: string, propName: string) => {
      const node = findNodeById(tree, componentId);
      if (node) {
        setSelectedNode(node);
        setHighlightedProp({ nodeId: componentId, propName });
        setTimeout(() => setHighlightedProp(null), 1500);
      }
    },
    [tree],
  );

  const handleHover = useCallback((node: NormalizedNode | null) => {
    setHighlights((prev) => {
      const next = new Map(prev);
      if (!node || !node._domElements?.length) {
        next.delete("user");
      } else {
        const rect = computeUnionRect(node._domElements);
        if (!rect) {
          next.delete("user");
          return next;
        }
        next.set("user", {
          id: "user",
          rect,
          name: node.name,
          source: "user",
          domElements: node._domElements,
          persist: false,
        });
      }
      return next;
    });
  }, []);

  const handleClearAiHighlight = useCallback(() => {
    setHighlights((prev) => {
      if (!prev.has("ai")) return prev;
      const next = new Map(prev);
      next.delete("ai");
      return next;
    });
  }, []);

  // Register MCP action callbacks (must be after handleSelect/handleHover declarations)
  useEffect(() => {
    devtoolsState.onSelectNode = (node: NormalizedNode) => {
      handleSelect(node);
      setActiveTab("inspect");
      const path = findNodePath(devtoolsState.tree, node.id);
      if (path) setExpandedNodeIds(new Set(path));
      setAiSelectedNodeIds((prev) => new Set(prev).add(node.id));
      setTimeout(() => {
        setAiSelectedNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      }, 5000);
    };
    devtoolsState.onHighlight = (
      node: NormalizedNode | null,
      source?: ActionSource,
      persist?: boolean,
    ) => {
      setHighlights((prev) => {
        const next = new Map(prev);
        if (!node) {
          next.delete("ai");
          return next;
        }
        if (!node._domElements?.length) return prev;
        // Scroll into view for AI highlights
        if (source === "ai") {
          node._domElements[0].scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
        const rect = computeUnionRect(node._domElements);
        if (!rect) return prev;
        const gen = Date.now();
        next.set("ai", {
          id: "ai",
          rect,
          name: node.name,
          source: source ?? "ai",
          domElements: node._domElements,
          persist: !!persist,
          _gen: gen,
        });
        return next;
      });
      // Auto-clear non-persistent AI highlights
      if (node && !persist) {
        const gen = Date.now();
        setTimeout(() => {
          setHighlights((prev) => {
            const entry = prev.get("ai");
            if (!entry || entry.persist || entry._gen !== gen) return prev;
            const next = new Map(prev);
            next.delete("ai");
            return next;
          });
        }, 3000);
      }
    };
    return () => {
      devtoolsState.onSelectNode = null;
      devtoolsState.onHighlight = null;
    };
  }, [handleSelect]);

  // rAF live-tracking: recompute highlight rects each frame while any highlights exist
  const hasHighlights = highlights.size > 0;
  useEffect(() => {
    if (!hasHighlights) return;
    let rafId: number;
    function tick() {
      setHighlights((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, entry] of next) {
          if (!entry.domElements.length) continue;
          const rect = computeUnionRect(entry.domElements);
          if (!rect) {
            next.delete(id);
            changed = true;
          } else if (
            rect.top !== entry.rect.top ||
            rect.left !== entry.rect.left ||
            rect.width !== entry.rect.width ||
            rect.height !== entry.rect.height
          ) {
            next.set(id, { ...entry, rect });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hasHighlights]);

  const handleContextMenu = useCallback(
    (e: MouseEvent, node: NormalizedNode) => {
      if (!node.source) return;
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleToastDismiss = useCallback((id: string) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id);
      if (!toast) return prev;
      if (toast.dismissedAt === null) {
        return prev.map((t) =>
          t.id === id ? { ...t, dismissedAt: Date.now() } : t,
        );
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const handleMcpPausedToggle = useCallback(() => {
    setMcpPaused((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.MCP_PAUSED, String(next));
      return next;
    });
  }, []);

  const handleShowAiActionsToggle = useCallback(() => {
    setShowAiActions((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.SHOW_AI_ACTIONS, String(next));
      return next;
    });
  }, []);

  const handleRenderCauseToggle = useCallback(() => {
    setRenderCauseEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.RENDER_CAUSE_ENABLED, String(next));
      window.dispatchEvent(new CustomEvent(EVENTS.REWALK));
      return next;
    });
  }, []);

  const handleRenderHistorySizeChange = useCallback((size: number) => {
    const clamped = Math.max(10, Math.min(2000, size));
    setRenderHistorySize(clamped);
    localStorage.setItem(STORAGE_KEYS.RENDER_HISTORY_SIZE, String(clamped));
  }, []);

  const handleRenderIncludeValuesToggle = useCallback(() => {
    setRenderIncludeValues((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.RENDER_INCLUDE_VALUES, String(next));
      return next;
    });
  }, []);

  const handleRenderHistoryRecordingToggle = useCallback(() => {
    setRenderHistoryRecordingState((prev) => {
      const next = !prev;
      devtoolsState.setRenderHistoryRecording(next);
      return next;
    });
  }, []);

  const handleClearRenderHistory = useCallback(() => {
    setRenderHistoryState([]);
    devtoolsState.setRenderHistory([]);
  }, []);

  const handlePinRenderComponent = useCallback(
    (persistentId: number | null) => {
      setPinnedRenderComponentId(persistentId);
      setActiveTab("renders");
    },
    [],
  );

  const handleDetach = useCallback(() => {
    popupManager?.detach();
  }, [popupManager]);

  const handleDockBack = useCallback(() => {
    popupManager?.dock();
  }, [popupManager]);

  const handleRefocusPopup = useCallback(() => {
    popupManager?.refocusPopup();
  }, [popupManager]);

  // Wire MCP control hooks so agents can toggle recording / clear history
  useEffect(() => {
    devtoolsState.onClearRenderHistory = handleClearRenderHistory;
    devtoolsState.onSetRenderHistoryRecording = (enabled: boolean) => {
      setRenderHistoryRecordingState(enabled);
      devtoolsState.setRenderHistoryRecording(enabled);
    };
    return () => {
      devtoolsState.onClearRenderHistory = null;
      devtoolsState.onSetRenderHistoryRecording = null;
    };
  }, [handleClearRenderHistory]);

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
      consoleStripLibrary={consoleStripLibrary}
      onConsoleStripLibraryToggle={handleConsoleStripLibraryToggle}
      clearConsoleOnReload={clearConsoleOnReload}
      onClearConsoleOnReloadToggle={handleClearConsoleOnReloadToggle}
      editedProps={editedProps}
      expandedPropsSet={expandedPropsSet}
      mcpEnabled={config.mcp ?? false}
      mcpPaused={mcpPaused}
      aiHighlightActive={highlights.has("ai")}
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
      onPropSourceClick={handlePropSourceClick}
      highlightedProp={highlightedProp}
      onClose={isDetached ? handleDockBack : togglePanel}
      mode={isDetached ? "popup" : "docked"}
      onDetach={popupManager ? handleDetach : undefined}
      onDockBack={handleDockBack}
      renderCauseEnabled={renderCauseEnabled}
      renderHistorySize={renderHistorySize}
      renderIncludeValues={renderIncludeValues}
      renderHistory={renderHistory}
      renderHistoryRecording={renderHistoryRecording}
      pinnedRenderComponentId={pinnedRenderComponentId}
      commitComponentIds={commitComponentIds}
      errorCountMap={errorCountMap}
      directErrorMap={directErrorMap}
      nodeHasError={nodeHasError}
      errorFilterActive={errorFilterActive}
      errorAncestorIds={errorAncestorIds}
      onErrorFilterToggle={() => setErrorFilterActive((prev) => !prev)}
      onRenderCauseToggle={handleRenderCauseToggle}
      onRenderHistorySizeChange={handleRenderHistorySizeChange}
      onRenderIncludeValuesToggle={handleRenderIncludeValuesToggle}
      onRenderHistoryRecordingToggle={handleRenderHistoryRecordingToggle}
      onClearRenderHistory={handleClearRenderHistory}
      onPinRenderComponent={handlePinRenderComponent}
      onNavigateToCommit={handleNavigateToCommit}
      focusCommitIndex={focusCommitIndex}
      onFocusCommitConsumed={() => setFocusCommitIndex(null)}
      locale={locale}
      onLocaleChange={handleLocaleChange}
    />
  );

  return (
    <I18nContext.Provider value={i18nValue}>
      <div style={{ height: 0 }}>
        <Highlight
          highlights={Array.from(highlights.values())}
          showAiActions={showAiActions}
        />

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
                label: `Open source — ${contextMenu.node.source.fileName.replace(/^.*\/src\//, "src/")}:${contextMenu.node.source.lineNumber}`,
                onClick: () => openInEditor(contextMenu.node.source!),
              },
              ...(contextMenu.node.usageSource
                ? [
                    {
                      label: `Open usage — ${contextMenu.node.usageSource.fileName.replace(/^.*\/src\//, "src/")}:${contextMenu.node.usageSource.lineNumber}`,
                      onClick: () =>
                        openInEditor(contextMenu.node.usageSource!),
                    },
                  ]
                : []),
            ]}
            onClose={closeContextMenu}
          />
        )}

        {toasts.length > 0 && (
          <ToastContainer
            toasts={toasts}
            dockPosition={dockPosition}
            onDismiss={handleToastDismiss}
          />
        )}
      </div>
    </I18nContext.Provider>
  );
}
