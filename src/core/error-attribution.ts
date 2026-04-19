import type {
  ConsoleEntry,
  NormalizedNode,
  NormalizedNodeSnapshot,
  SourceLocation,
  StackFrame,
  CommitRecord,
} from './types'

// ---- Types ----

export interface ErrorContext {
  error: {
    id: string
    type: string
    message: string
    stack: string | null
    frames: StackFrame[] | null
  }
  ownedBy: { name: string; nodeId: string; source: SourceLocation | null } | null
  caughtBy: { componentName: string; nodeId: string } | null
  snapshot: NormalizedNodeSnapshot | null
  ancestors: Array<{ name: string; source: SourceLocation | null }>
  renderHistory: CommitRecord[] | null
}

// ---- Internal helpers ----

/** Flatten a NormalizedNode tree into a flat array */
export function flattenTree(tree: NormalizedNode[]): NormalizedNode[] {
  const result: NormalizedNode[] = []
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    result.push(node)
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i])
    }
  }
  return result
}

/** Build a parent map: nodeId → parent NormalizedNode */
function buildParentMap(tree: NormalizedNode[]): Map<string, NormalizedNode> {
  const map = new Map<string, NormalizedNode>()
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    for (const child of node.children) {
      map.set(child.id, node)
      stack.push(child)
    }
  }
  return map
}

/** Check if a frame's file matches a component's source file (suffix matching) */
function fileMatches(frameFile: string, sourceFileName: string): boolean {
  // Normalize separators
  const normFrame = frameFile.replace(/\\/g, '/')
  const normSource = sourceFileName.replace(/\\/g, '/')
  return normFrame === normSource || normFrame.endsWith(normSource) || normSource.endsWith(normFrame)
}

/** Check if a line falls within a component's line range */
function lineInRange(line: number, source: SourceLocation): boolean {
  if (!source.endLineNumber) return true // no range info, file match is enough
  return line >= source.lineNumber && line <= source.endLineNumber
}

/** Create a snapshot of a NormalizedNode (clone minus live refs) */
function snapshotNode(node: NormalizedNode): NormalizedNodeSnapshot {
  return {
    id: node.id,
    name: node.name,
    source: node.source ? { ...node.source } : null,
    props: { ...node.props },
    sections: node.sections.map(s => ({
      id: s.id,
      label: s.label,
      items: JSON.parse(JSON.stringify(s.items)),
    })),
    isErrorBoundary: node.isErrorBoundary,
    renderCause: node.renderCause ? { ...node.renderCause } : undefined,
    depWarnings: node.depWarnings ? [...node.depWarnings] : undefined,
    memoStats: node.memoStats ? { ...node.memoStats } : undefined,
    locals: node.locals ? [...node.locals] : undefined,
  }
}

// ---- Public API ----

/**
 * Attribute a console error/warning to its owning component.
 * Mutates the entry in place: sets ownedBy, caughtBy, snapshot.
 *
 * Strategy A: file match — topmost non-library frame matched against component source.fileName
 * Strategy B: line-range match — among file matches, prefer the one whose [lineNumber, endLineNumber] range contains the frame's line
 * Strategy C: boundary walk — walk up ancestors for nearest isErrorBoundary
 */
export function attributeError(entry: ConsoleEntry, tree: NormalizedNode[]): void {
  if (!entry.frames || entry.frames.length === 0) return
  if (tree.length === 0) return

  // Find topmost non-library user frame
  const userFrame = entry.frames.find(f => !f.isLibrary)
  if (!userFrame) return

  const allNodes = flattenTree(tree)

  // Strategy A + B: find the best matching component
  let bestMatch: NormalizedNode | null = null
  let bestIsRangeMatch = false

  for (const node of allNodes) {
    if (!node.source || node.isHostElement) continue
    if (!fileMatches(userFrame.file, node.source.fileName)) continue

    const inRange = lineInRange(userFrame.line, node.source)

    if (!bestMatch) {
      bestMatch = node
      bestIsRangeMatch = inRange && !!node.source.endLineNumber
    } else if (inRange && node.source.endLineNumber && !bestIsRangeMatch) {
      // Prefer range match over file-only match
      bestMatch = node
      bestIsRangeMatch = true
    } else if (inRange && node.source.endLineNumber && bestIsRangeMatch) {
      // Among range matches, prefer the narrower range (more specific component)
      const bestRange = (bestMatch.source!.endLineNumber ?? Infinity) - bestMatch.source!.lineNumber
      const nodeRange = node.source.endLineNumber - node.source.lineNumber
      if (nodeRange < bestRange) {
        bestMatch = node
      }
    }
  }

  if (!bestMatch) return

  // Set ownedBy
  entry.ownedBy = {
    name: bestMatch.name,
    nodeId: bestMatch.id,
    source: bestMatch.source ? { ...bestMatch.source } : null,
  }

  // Snapshot the owning component
  entry.snapshot = snapshotNode(bestMatch)

  // Strategy C: walk up for nearest error boundary
  const parentMap = buildParentMap(tree)
  let current = parentMap.get(bestMatch.id)
  while (current) {
    if (current.isErrorBoundary) {
      entry.caughtBy = {
        componentName: current.name,
        nodeId: current.id,
      }
      break
    }
    current = parentMap.get(current.id)
  }
}

/**
 * Build full error context for the MCP getErrorContext tool.
 * Returns the deep bundle: error details, snapshot, boundary, ancestors, render history.
 */
export function buildErrorContext(
  entry: ConsoleEntry,
  tree: NormalizedNode[],
  renderHistory?: CommitRecord[],
): ErrorContext {
  // Build ancestor chain
  const ancestors: Array<{ name: string; source: SourceLocation | null }> = []
  if (entry.ownedBy && tree.length > 0) {
    const parentMap = buildParentMap(tree)
    let current = parentMap.get(entry.ownedBy.nodeId)
    while (current) {
      ancestors.push({ name: current.name, source: current.source })
      current = parentMap.get(current.id)
    }
  }

  // Filter render history to owning component (by persistentId if available)
  let componentHistory: CommitRecord[] | null = null
  if (renderHistory && entry.snapshot) {
    const filtered = renderHistory
      .map(commit => ({
        ...commit,
        components: commit.components.filter(c => c.name === entry.ownedBy?.name),
      }))
      .filter(commit => commit.components.length > 0)
    if (filtered.length > 0) componentHistory = filtered
  }

  return {
    error: {
      id: entry.id,
      type: entry.type,
      message: entry.message,
      stack: entry.stack,
      frames: entry.frames,
    },
    ownedBy: entry.ownedBy ?? null,
    caughtBy: entry.caughtBy ?? null,
    snapshot: entry.snapshot ?? null,
    ancestors,
    renderHistory: componentHistory,
  }
}

/**
 * Build the ancestor chain for a given node ID.
 * Used by clipboard format to include parent context.
 */
export function buildAncestorChain(
  nodeId: string,
  tree: NormalizedNode[],
): Array<{ name: string; source: SourceLocation | null }> {
  const parentMap = buildParentMap(tree)
  const ancestors: Array<{ name: string; source: SourceLocation | null }> = []
  let current = parentMap.get(nodeId)
  while (current) {
    ancestors.push({ name: current.name, source: current.source })
    current = parentMap.get(current.id)
  }
  return ancestors
}
